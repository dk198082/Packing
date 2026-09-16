import { createInsertSchema } from "drizzle-zod";
import { pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { z } from "zod/v4";

export const packStatusesTable = pgTable("pack_statuses", {
  orderId: text("order_id").primaryKey(),
  packStartedAt: timestamp("pack_started_at", { withTimezone: true }),
});

export const insertPackStatusSchema = createInsertSchema(packStatusesTable);
export type InsertPackStatus = z.infer<typeof insertPackStatusSchema>;
export type PackStatus = typeof packStatusesTable.$inferSelect;