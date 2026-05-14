import { pgTable, text, serial, timestamp, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const habitsTable = pgTable("habits", {
  id: serial("id").primaryKey(),
  telegramId: text("telegram_id").notNull(),
  name: text("name").notNull(),
  reminderTime: text("reminder_time").notNull(),
  reminderTime2: text("reminder_time_2"),
  reminderTime3: text("reminder_time_3"),
  category: text("category"),
  description: text("description"),
  pausedUntil: text("paused_until"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertHabitSchema = createInsertSchema(habitsTable).omit({ id: true, createdAt: true });
export type InsertHabit = z.infer<typeof insertHabitSchema>;
export type Habit = typeof habitsTable.$inferSelect;
