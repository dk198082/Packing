import { createInsertSchema } from "drizzle-zod";
import { pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { z } from "zod/v4";

export const inPackingEntriesTable = pgTable("in_packing_entries", {
  orderId: text("order_id").primaryKey(),
  enteredPackingAt: timestamp("entered_packing_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const insertInPackingEntrySchema = createInsertSchema(inPackingEntriesTable);
export type InsertInPackingEntry = z.infer<typeof insertInPackingEntrySchema>;
export type InPackingEntry = typeof inPackingEntriesTable.$inferSelect;