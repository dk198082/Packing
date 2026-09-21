import { createInsertSchema } from "drizzle-zod";
import { integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { z } from "zod/v4";

export const systemOrderPrioritiesTable = pgTable("system_order_priorities", {
  orderId: text("order_id").primaryKey(),
  priority: integer("priority").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const insertSystemOrderPrioritySchema = createInsertSchema(
  systemOrderPrioritiesTable,
);
export type InsertSystemOrderPriority = z.infer<
  typeof insertSystemOrderPrioritySchema
>;
export type SystemOrderPriority =
  typeof systemOrderPrioritiesTable.$inferSelect;