import { pgTable, text, serial, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const supplementCheckinsTable = pgTable("supplement_checkins", {
  id: serial("id").primaryKey(),
  telegramId: text("telegram_id").notNull(),
  checkinDate: text("checkin_date").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertSupplementCheckinSchema = createInsertSchema(supplementCheckinsTable).omit({ id: true, createdAt: true });
export type InsertSupplementCheckin = z.infer<typeof insertSupplementCheckinSchema>;
export type SupplementCheckin = typeof supplementCheckinsTable.$inferSelect;
