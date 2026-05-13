import { pgTable, text, serial, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const waterLogsTable = pgTable("water_logs", {
  id: serial("id").primaryKey(),
  telegramId: text("telegram_id").notNull(),
  amountMl: integer("amount_ml").notNull(),
  logDate: text("log_date").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertWaterLogSchema = createInsertSchema(waterLogsTable).omit({ id: true, createdAt: true });
export type InsertWaterLog = z.infer<typeof insertWaterLogSchema>;
export type WaterLog = typeof waterLogsTable.$inferSelect;
