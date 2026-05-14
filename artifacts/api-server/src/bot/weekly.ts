import { db, completionsTable, habitsTable, waterLogsTable, supplementCheckinsTable } from "@workspace/db";
import { eq, and, gte, lte } from "drizzle-orm";
import { WATER_GOAL_ML } from "./water";
import { generateWeeklyAward } from "./messages";

function todayStr(timezone: string): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: timezone });
}

function weekBounds(timezone: string): { start: string; end: string; daysElapsed: number; isSunday: boolean } {
  const today = todayStr(timezone);
  const todayDate = new Date(today + "T12:00:00Z");
  const dayOfWeek = todayDate.getDay(); // 0=Sun, 1=Mon...6=Sat
  const isSunday = dayOfWeek === 0;

  const daysFromMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  const weekStart = new Date(todayDate);
  weekStart.setUTCDate(todayDate.getUTCDate() - daysFromMonday);

  return {
    start: weekStart.toISOString().slice(0, 10),
    end: today,
    daysElapsed: daysFromMonday + 1,
    isSunday,
  };
}

export function isSundayEvening(timezone: string): boolean {
  const now = new Date();
  const localTime = now.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: timezone,
  });
  const dayName = now.toLocaleDateString("en-US", { weekday: "short", timeZone: timezone });
  return dayName === "Sun" && localTime === "20:00";
}

export async function buildWeeklyWrapup(telegramId: string, timezone: string): Promise<string> {
  const { start, end, daysElapsed } = weekBounds(timezone);

  const weekLabel = new Date(start + "T12:00:00Z").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
  const endLabel = new Date(end + "T12:00:00Z").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });

  // Water
  const waterRows = await db
    .select()
    .from(waterLogsTable)
    .where(and(eq(waterLogsTable.telegramId, telegramId), gte(waterLogsTable.logDate, start), lte(waterLogsTable.logDate, end)));
  const waterByDay: Record<string, number> = {};
  for (const r of waterRows) waterByDay[r.logDate] = (waterByDay[r.logDate] ?? 0) + r.amountMl;
  const waterGoalDays = Object.values(waterByDay).filter((ml) => ml >= WATER_GOAL_ML).length;

  // Supplement
  const suppRows = await db
    .select()
    .from(supplementCheckinsTable)
    .where(and(eq(supplementCheckinsTable.telegramId, telegramId), gte(supplementCheckinsTable.checkinDate, start), lte(supplementCheckinsTable.checkinDate, end)));
  const suppDays = suppRows.length;

  // Habits
  const habits = await db.select().from(habitsTable).where(and(eq(habitsTable.telegramId, telegramId), eq(habitsTable.isActive, true)));
  const completions = await db
    .select()
    .from(completionsTable)
    .where(and(eq(completionsTable.telegramId, telegramId), gte(completionsTable.completedDate, start), lte(completionsTable.completedDate, end)));

  const completionsByHabit: Record<number, number> = {};
  for (const c of completions) {
    completionsByHabit[c.habitId] = (completionsByHabit[c.habitId] ?? 0) + 1;
  }

  let totalHabitDays = 0;
  let topHabit: { name: string; category: string | null; done: number } | null = null;
  const habitLines: string[] = [];

  for (const h of habits) {
    const done = completionsByHabit[h.id] ?? 0;
    totalHabitDays += done;
    const pct = daysElapsed > 0 ? Math.round((done / daysElapsed) * 100) : 0;
    const bar = "▓".repeat(Math.round(pct / 100 * 5)) + "░".repeat(5 - Math.round(pct / 100 * 5));
    habitLines.push(`${bar} *${h.name}*: ${done}/${daysElapsed} days`);
    if (!topHabit || done > topHabit.done) {
      topHabit = { name: h.name, category: h.category ?? null, done };
    }
  }

  const award = generateWeeklyAward({ waterGoalDays, suppDays, topHabit, totalHabitDays, daysElapsed });

  const lines = [
    `🗓️ *Weekly Wrap-up — ${weekLabel} to ${endLabel}*`,
    ``,
    `💧 Water goal hit: *${waterGoalDays}/7 days*`,
    `💊 Supplement taken: *${suppDays}/${daysElapsed} days*`,
    ...(habitLines.length > 0 ? [``, `✨ *Habits this week:*`, ...habitLines] : []),
    ``,
    `────────────────`,
    ``,
    `🏆 *Your Award:*`,
    ``,
    award,
  ];

  return lines.join("\n");
}
