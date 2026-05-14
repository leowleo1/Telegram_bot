import { db, supplementCheckinsTable, waterLogsTable, completionsTable, habitsTable } from "@workspace/db";
import { eq, and, gte, lte } from "drizzle-orm";
import { WATER_GOAL_ML } from "./water";

function monthBounds(timezone: string): { start: string; end: string; label: string; daysInMonth: number } {
  const now = new Date();
  const localStr = now.toLocaleDateString("en-CA", { timeZone: timezone });
  const [year, month] = localStr.split("-").map(Number) as [number, number];
  const start = `${year}-${String(month).padStart(2, "0")}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const end = `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
  const label = new Date(year, month - 1, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });
  return { start, end, label, daysInMonth: lastDay };
}

function todayStr(timezone: string): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: timezone });
}

function daysBetween(from: string, to: string): number {
  return Math.floor((new Date(to).getTime() - new Date(from).getTime()) / 86400000) + 1;
}

function formatDate(dateStr: string): string {
  return new Date(dateStr + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function motivationalLine(pct: number): string {
  if (pct >= 90) return "🌟 Incredible consistency — you're on fire!";
  if (pct >= 75) return "💪 Really strong — keep the momentum!";
  if (pct >= 50) return "📈 Solid progress — more than half the days nailed!";
  if (pct >= 25) return "🌱 You've started — now build on it!";
  return "💫 Every day is a fresh chance — let's go!";
}

function pctBar(pct: number, width = 8): string {
  const filled = Math.round((pct / 100) * width);
  return "▓".repeat(filled) + "░".repeat(width - filled);
}

export async function buildMonthlyStats(
  telegramId: string,
  timezone: string,
  cycleStartDate?: string | null,
): Promise<string> {
  const { start: monthStart, end: monthEnd, label, daysInMonth } = monthBounds(timezone);
  const today = todayStr(timezone);
  const monthElapsed = daysBetween(monthStart, today);

  // --- Supplement: track from cycle start date if available, else from month start ---
  let suppSectionLabel: string;
  let suppTrackStart: string;

  if (cycleStartDate && cycleStartDate >= monthStart) {
    suppTrackStart = cycleStartDate;
    suppSectionLabel = `since ${formatDate(cycleStartDate)}`;
  } else if (cycleStartDate && cycleStartDate < monthStart) {
    suppTrackStart = monthStart;
    suppSectionLabel = `this month (cycle started ${formatDate(cycleStartDate)})`;
  } else {
    suppTrackStart = monthStart;
    suppSectionLabel = "this month";
  }

  const suppElapsed = daysBetween(suppTrackStart, today);

  const suppRows = await db
    .select()
    .from(supplementCheckinsTable)
    .where(
      and(
        eq(supplementCheckinsTable.telegramId, telegramId),
        gte(supplementCheckinsTable.checkinDate, suppTrackStart),
        lte(supplementCheckinsTable.checkinDate, today),
      ),
    );
  const suppDays = suppRows.length;
  const suppSkipped = Math.max(0, suppElapsed - suppDays);
  const suppPct = suppElapsed > 0 ? Math.round((suppDays / suppElapsed) * 100) : 0;

  // --- Water: always this month ---
  const waterRows = await db
    .select()
    .from(waterLogsTable)
    .where(
      and(
        eq(waterLogsTable.telegramId, telegramId),
        gte(waterLogsTable.logDate, monthStart),
        lte(waterLogsTable.logDate, today),
      ),
    );

  const waterByDay: Record<string, number> = {};
  for (const row of waterRows) {
    waterByDay[row.logDate] = (waterByDay[row.logDate] ?? 0) + row.amountMl;
  }
  const waterDaysLogged = Object.keys(waterByDay).length;
  const waterDaysGoalHit = Object.values(waterByDay).filter((ml) => ml >= WATER_GOAL_ML).length;
  const totalWaterMl = Object.values(waterByDay).reduce((a, b) => a + b, 0);
  const avgWater = waterDaysLogged > 0 ? Math.round(totalWaterMl / waterDaysLogged) : 0;
  const waterPct = monthElapsed > 0 ? Math.round((waterDaysGoalHit / monthElapsed) * 100) : 0;

  // --- Habits: always this month ---
  const habits = await db
    .select()
    .from(habitsTable)
    .where(and(eq(habitsTable.telegramId, telegramId), eq(habitsTable.isActive, true)));

  const habitLines: string[] = [];
  for (const habit of habits) {
    const rows = await db
      .select()
      .from(completionsTable)
      .where(
        and(
          eq(completionsTable.telegramId, telegramId),
          eq(completionsTable.habitId, habit.id),
          gte(completionsTable.completedDate, monthStart),
          lte(completionsTable.completedDate, today),
        ),
      );
    const done = rows.length;
    const pct = monthElapsed > 0 ? Math.round((done / monthElapsed) * 100) : 0;
    const bar = pctBar(pct, 6);
    habitLines.push(`${bar} *${habit.name}*: ${done}/${monthElapsed} days (${pct}%)`);
  }

  const overallPct = Math.round((suppPct + waterPct) / 2);
  const motive = motivationalLine(overallPct);

  const lines = [
    `📊 *${label} Stats*`,
    `_${monthElapsed} of ${daysInMonth} days into the month_`,
    ``,
    `💊 *Daily Supplement* — _${suppSectionLabel}_`,
    `${pctBar(suppPct)} ${suppPct}%`,
    `✅ Taken: ${suppDays} days  ❌ Skipped: ${suppSkipped} days`,
    ``,
    `💧 *Water (2L goal)* — _this month_`,
    `${pctBar(waterPct)} ${waterPct}% of days hit goal`,
    `🏆 Goal hit: ${waterDaysGoalHit} days  📊 Avg: ${avgWater}ml/day`,
    ...(waterDaysLogged === 0 ? [`_No water logged yet this month_`] : []),
    ``,
  ];

  if (habitLines.length > 0) {
    lines.push(`✨ *Habits* — _this month_`);
    lines.push(...habitLines);
    lines.push(``);
  }

  lines.push(motive);

  return lines.join("\n");
}
