import { randomUUID } from "node:crypto";
import { getAzurePool, getAzureQualifiedTableName } from "@workspace/db/azure";
import type { AuthenticatedUser } from "./auth";

export interface MessageAcknowledgment {
  userId: string;
  displayName: string;
  acknowledgedAt: string;
}

export interface PackingMessage {
  id: string;
  content: string;
  authorId: string;
  authorName: string;
  createdAt: string;
  acknowledgments: MessageAcknowledgment[];
}

export class MessageBoardError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
  }
}

let tablesReady: Promise<void> | undefined;

// Only new, app-owned tables are created. ERP source tables are never written.
async function ensureMessageTables(): Promise<void> {
  if (!tablesReady) {
    tablesReady = (async () => {
      const client = await getAzurePool().connect();
      try {
        await client.query("BEGIN");
        await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
          "packing-control-board.message-board-schema",
        ]);
        const messages = getAzureQualifiedTableName("packing_messages");
        const acknowledgments = getAzureQualifiedTableName("packing_message_acknowledgments");
        await client.query(`
          CREATE TABLE IF NOT EXISTS ${messages} (
            id uuid PRIMARY KEY,
            content text NOT NULL,
            author_id text NOT NULL,
            author_name text NOT NULL,
            created_at timestamptz NOT NULL DEFAULT NOW(),
            archived_at timestamptz
          )
        `);
        // Upgrade the existing 1,000-character check without deleting older messages.
        // NOT VALID enforces the new limit on writes while preserving any older long messages.
        await client.query(`ALTER TABLE ${messages} DROP CONSTRAINT IF EXISTS packing_messages_content_check`);
        await client.query(`
          ALTER TABLE ${messages}
          ADD CONSTRAINT packing_messages_content_check
          CHECK (char_length(btrim(content)) BETWEEN 1 AND 200) NOT VALID
        `);
        await client.query(`ALTER TABLE ${messages} ADD COLUMN IF NOT EXISTS archived_at timestamptz`);
        await client.query(`
          CREATE TABLE IF NOT EXISTS ${acknowledgments} (
            message_id uuid NOT NULL REFERENCES ${messages}(id),
            user_id text NOT NULL,
            display_name text NOT NULL,
            acknowledged_at timestamptz NOT NULL DEFAULT NOW(),
            PRIMARY KEY (message_id, user_id)
          )
        `);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    })().catch((error) => {
      tablesReady = undefined;
      throw error;
    });
  }
  await tablesReady;
}

interface MessageRow {
  id: string;
  content: string;
  author_id: string;
  author_name: string;
  created_at: Date;
  acknowledgments: MessageAcknowledgment[];
}

async function readMessages(messageId?: string): Promise<PackingMessage[]> {
  await ensureMessageTables();
  const messages = getAzureQualifiedTableName("packing_messages");
  const acknowledgments = getAzureQualifiedTableName("packing_message_acknowledgments");
  const result = await getAzurePool().query<MessageRow>(`
    SELECT m.id, m.content, m.author_id, m.author_name, m.created_at,
      COALESCE(
        jsonb_agg(jsonb_build_object(
          'userId', a.user_id,
          'displayName', a.display_name,
          'acknowledgedAt', a.acknowledged_at
        ) ORDER BY a.acknowledged_at, a.user_id) FILTER (WHERE a.user_id IS NOT NULL),
        '[]'::jsonb
      ) AS acknowledgments
    FROM ${messages} m
    LEFT JOIN ${acknowledgments} a ON a.message_id = m.id
    ${messageId ? "WHERE m.id = $1" : ""}
    GROUP BY m.id
    HAVING MIN(a.acknowledged_at) IS NULL
      OR MIN(a.acknowledged_at) > NOW() - INTERVAL '168 hours'
    ORDER BY m.created_at DESC, m.id DESC
  `, messageId ? [messageId] : []);

  return result.rows.map((row) => ({
    id: row.id,
    content: row.content,
    authorId: row.author_id,
    authorName: row.author_name,
    createdAt: row.created_at.toISOString(),
    acknowledgments: row.acknowledgments.map((ack) => ({
      ...ack,
      acknowledgedAt: new Date(ack.acknowledgedAt).toISOString(),
    })),
  }));
}

export async function listPackingMessages(): Promise<PackingMessage[]> {
  return readMessages();
}

export async function createPackingMessage(
  content: string,
  user: AuthenticatedUser,
): Promise<PackingMessage> {
  await ensureMessageTables();
  const table = getAzureQualifiedTableName("packing_messages");
  const id = randomUUID();
  await getAzurePool().query(`
    INSERT INTO ${table} (id, content, author_id, author_name)
    VALUES ($1, $2, $3, $4)
  `, [id, content, user.entraOid, user.displayName]);
  const [message] = await readMessages(id);
  if (!message) throw new Error("Saved message could not be read.");
  return message;
}

export async function acknowledgePackingMessage(
  messageId: string,
  user: AuthenticatedUser,
): Promise<PackingMessage> {
  const [message] = await readMessages(messageId);
  if (!message) throw new MessageBoardError(404, "Message not found.");
  if (message.authorId === user.entraOid && user.role !== "editor") {
    throw new MessageBoardError(403, "Read/Write access is required to OK your own message.");
  }
  const table = getAzureQualifiedTableName("packing_message_acknowledgments");
  // Idempotent across repeated clicks and sessions; preserve the first OK time.
  await getAzurePool().query(`
    INSERT INTO ${table} (message_id, user_id, display_name)
    SELECT $1, $2, $3
    WHERE NOT EXISTS (
      SELECT 1 FROM ${table}
      WHERE message_id = $1
        AND acknowledged_at <= NOW() - INTERVAL '168 hours'
    )
    ON CONFLICT (message_id, user_id) DO NOTHING
  `, [messageId, user.entraOid, user.displayName]);
  const [updated] = await readMessages(messageId);
  if (!updated) throw new MessageBoardError(404, "Message is no longer on the board.");
  return updated;
}
