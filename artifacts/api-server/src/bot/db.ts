import { db, usersTable, habitsTable, completionsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";

export async function getOrCreateUser(telegramId: string, username?: string) {
  const existing = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.telegramId, telegramId))
    .limit(1);

  if (existing.length > 0) return existing[0]!;

  const [user] = await db
    .insert(usersTable)
    .values({ telegramId, username: username ?? null })
    .returning();
  return user!;
}

export async function getUser(telegramId: string) {
  const rows = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.telegramId, telegramId))
    .limit(1);
  return rows[0] ?? null;
}

export async function setUserTimezone(telegramId: string, timezone: string) {
  await db
    .update(usersTable)
    .set({ timezone })
    .where(eq(usersTable.telegramId, telegramId));
}

export async function setEkstrajenStartDate(telegramId: string, startDate: string) {
  await db
    .update(usersTable)
    .set({ ekstrajenStartDate: startDate })
    .where(eq(usersTable.telegramId, telegramId));
}

export async function getUserHabits(telegramId: string) {
  return db
    .select()
    .from(habitsTable)
    .where(and(eq(habitsTable.telegramId, telegramId), eq(habitsTable.isActive, true)));
}

export async function addHabit(telegramId: string, name: string, reminderTime: string) {
  const [habit] = await db
    .insert(habitsTable)
    .values({ telegramId, name, reminderTime })
    .returning();
  return habit!;
}

export async function deleteHabit(habitId: number, telegramId: string) {
  await db
    .update(habitsTable)
    .set({ isActive: false })
    .where(and(eq(habitsTable.id, habitId), eq(habitsTable.telegramId, telegramId)));
}

export async function markHabitDone(habitId: number, telegramId: string, date: string) {
  const existing = await db
    .select()
    .from(completionsTable)
    .where(
      and(
        eq(completionsTable.habitId, habitId),
        eq(completionsTable.telegramId, telegramId),
        eq(completionsTable.completedDate, date),
      ),
    )
    .limit(1);

  if (existing.length > 0) return false;

  await db.insert(completionsTable).values({ habitId, telegramId, completedDate: date });
  return true;
}

export async function getTodayCompletions(telegramId: string, date: string) {
  return db
    .select()
    .from(completionsTable)
    .where(and(eq(completionsTable.telegramId, telegramId), eq(completionsTable.completedDate, date)));
}

export async function getStreakForHabit(habitId: number, telegramId: string): Promise<number> {
  const rows = await db
    .select()
    .from(completionsTable)
    .where(and(eq(completionsTable.habitId, habitId), eq(completionsTable.telegramId, telegramId)));

  const dates = new Set(rows.map((r) => r.completedDate));

  let streak = 0;
  const today = new Date();
  for (let i = 0; i < 365; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    if (dates.has(key)) {
      streak++;
    } else {
      break;
    }
  }
  return streak;
}
