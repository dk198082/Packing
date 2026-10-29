import { createInsertSchema } from "drizzle-zod";
import { pgTable, text, uuid, timestamp, primaryKey } from "drizzle-orm/pg-core";
import { z } from "zod/v4";

// App-owned Azure tables, initialized through the server's message store.
export const packingMessagesTable = pgTable("packing_messages", {
  id: uuid("id").primaryKey(),
  content: text("content").notNull(),
  authorId: text("author_id").notNull(),
  authorName: text("author_name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
});
export const insertPackingMessageSchema = createInsertSchema(packingMessagesTable)
  .omit({ createdAt: true });
export type InsertPackingMessage = z.infer<typeof insertPackingMessageSchema>;
export type PackingMessage = typeof packingMessagesTable.$inferSelect;

export const packingMessageAcknowledgmentsTable = pgTable("packing_message_acknowledgments", {
  messageId: uuid("message_id").notNull().references(() => packingMessagesTable.id),
  userId: text("user_id").notNull(),
  displayName: text("display_name").notNull(),
  acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [primaryKey({ columns: [table.messageId, table.userId] })]);
export const insertMessageAcknowledgmentSchema = createInsertSchema(packingMessageAcknowledgmentsTable)
  .omit({ acknowledgedAt: true });
export type InsertMessageAcknowledgment = z.infer<typeof insertMessageAcknowledgmentSchema>;
export type MessageAcknowledgment = typeof packingMessageAcknowledgmentsTable.$inferSelect;
