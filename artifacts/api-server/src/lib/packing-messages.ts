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
  recipientId: string | null;
  recipientName: string | null;
  createdAt: string;
  acknowledgments: MessageAcknowledgment[];
}

export interface MessageRecipient {
  userId: string;
  displayName: string;
  email: string;
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
        await client.query(`ALTER TABLE ${messages} ADD COLUMN IF NOT EXISTS recipient_id text`);
        await client.query(`ALTER TABLE ${messages} ADD COLUMN IF NOT EXISTS recipient_name text`);
        await client.query(`
          CREATE TABLE IF NOT EXISTS ${getAzureQualifiedTableName("packing_message_users")} (
            user_id text PRIMARY KEY,
            display_name text NOT NULL,
            email text NOT NULL,
            last_seen_at timestamptz NOT NULL DEFAULT NOW()
          )
        `);
        await client.query(`
          CREATE TABLE IF NOT EXISTS ${getAzureQualifiedTableName("packing_message_removals")} (
            message_id uuid PRIMARY KEY REFERENCES ${messages}(id),
            removed_by text NOT NULL,
            removed_at timestamptz NOT NULL DEFAULT NOW()
          )
        `);
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
  recipient_id: string | null;
  recipient_name: string | null;
  created_at: Date;
  acknowledgments: MessageAcknowledgment[];
}

type MessageClient = Pick<ReturnType<typeof getAzurePool>, "query">;

async function readMessages(messageId?: string, client?: MessageClient, userId?: string): Promise<PackingMessage[]> {
  await ensureMessageTables();
  const messages = getAzureQualifiedTableName("packing_messages");
  const acknowledgments = getAzureQualifiedTableName("packing_message_acknowledgments");
  const result = await (client ?? getAzurePool()).query<MessageRow>(`
    SELECT m.id, m.content, m.author_id, m.author_name, m.recipient_id, m.recipient_name, m.created_at,
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
    WHERE NOT EXISTS (
      SELECT 1 FROM ${getAzureQualifiedTableName("packing_message_removals")} r WHERE r.message_id = m.id
    ) ${messageId ? "AND m.id = $1" : ""}
    ${userId ? "AND (m.author_id = $1 OR m.recipient_id = $1)" : ""}
    GROUP BY m.id
    HAVING MIN(a.acknowledged_at) IS NULL
      OR MIN(a.acknowledged_at) > NOW() - INTERVAL '168 hours'
    ORDER BY m.created_at DESC, m.id DESC
  `, messageId ? [messageId] : userId ? [userId] : []);

  return result.rows.map((row) => ({
    id: row.id,
    content: row.content,
    authorId: row.author_id,
    authorName: row.author_name,
    recipientId: row.recipient_id,
    recipientName: row.recipient_name,
    createdAt: row.created_at.toISOString(),
    acknowledgments: row.acknowledgments.map((ack) => ({
      ...ack,
      acknowledgedAt: new Date(ack.acknowledgedAt).toISOString(),
    })),
  }));
}

export async function listPackingMessages(user: AuthenticatedUser): Promise<PackingMessage[]> {
  return readMessages(undefined, undefined, user.entraOid);
}

// Directory metadata only: Admin Console remains the source of authorization.
export async function rememberMessageUser(user: AuthenticatedUser): Promise<void> {
  await ensureMessageTables();
  const table = getAzureQualifiedTableName("packing_message_users");
  await getAzurePool().query(`
    INSERT INTO ${table} AS existing (user_id, display_name, email)
    VALUES ($1, $2, $3)
    ON CONFLICT (user_id) DO UPDATE SET
      display_name = EXCLUDED.display_name, email = EXCLUDED.email, last_seen_at = NOW()
    WHERE existing.display_name IS DISTINCT FROM EXCLUDED.display_name
      OR existing.email IS DISTINCT FROM EXCLUDED.email
      OR existing.last_seen_at < NOW() - INTERVAL '1 hour'
  `, [user.entraOid, user.displayName, user.email]);
}

export async function getKnownMessageUsers(): Promise<MessageRecipient[]> {
  await ensureMessageTables();
  const result = await getAzurePool().query<{ user_id: string; display_name: string; email: string }>(
    `SELECT user_id, display_name, email FROM ${getAzureQualifiedTableName("packing_message_users")} ORDER BY lower(display_name), user_id`,
  );
  return result.rows.map(row => ({ userId: row.user_id, displayName: row.display_name, email: row.email }));
}

export async function createPackingMessage(
  content: string,
  recipientId: string,
  user: AuthenticatedUser,
): Promise<PackingMessage> {
  await ensureMessageTables();
  if (recipientId === user.entraOid) throw new MessageBoardError(400, "Choose another user as the recipient.");
  const recipient = (await getKnownMessageUsers()).find(item => item.userId === recipientId);
  if (!recipient) throw new MessageBoardError(400, "Recipient has not signed in to the Packing Board.");
  const table = getAzureQualifiedTableName("packing_messages");
  const id = randomUUID();
  await getAzurePool().query(`
    INSERT INTO ${table} (id, content, author_id, author_name, recipient_id, recipient_name)
    VALUES ($1, $2, $3, $4, $5, $6)
  `, [id, content, user.entraOid, user.displayName, recipient.userId, recipient.displayName]);
  const [message] = await readMessages(id);
  if (!message) throw new Error("Saved message could not be read.");
  return message;
}

export async function acknowledgePackingMessage(
  messageId: string,
  user: AuthenticatedUser,
): Promise<PackingMessage> {
  return withLockedMessage(messageId, user, async (client, message) => {
  if (message.recipientId !== null && message.recipientId !== user.entraOid) {
    throw new MessageBoardError(403, "Only the selected recipient may OK this message.");
  }
  if (message.recipientId === null && user.role !== "editor") {
    throw new MessageBoardError(403, "Read/Write access is required to OK a legacy message.");
  }
  const table = getAzureQualifiedTableName("packing_message_acknowledgments");
  // Idempotent across repeated clicks and sessions; preserve the first OK time.
  await client.query(`
    INSERT INTO ${table} (message_id, user_id, display_name)
    SELECT $1, $2, $3
    WHERE NOT EXISTS (
      SELECT 1 FROM ${table}
      WHERE message_id = $1
        AND acknowledged_at <= NOW() - INTERVAL '168 hours'
    )
    ON CONFLICT (message_id, user_id) DO NOTHING
  `, [messageId, user.entraOid, user.displayName]);
  const [updated] = await readMessages(messageId, client);
  if (!updated) throw new MessageBoardError(404, "Message is no longer on the board.");
  return updated;
  });
}

// Serialize OK/reset/removal for each message so concurrent sessions cannot
// acknowledge a removed message or leave a partially reset set of OKs.
async function withLockedMessage<T>(
  messageId: string,
  user: AuthenticatedUser,
  action: (client: MessageClient, message: PackingMessage) => Promise<T>,
): Promise<T> {
  await ensureMessageTables();
  const client = await getAzurePool().connect();
  try {
    await client.query("BEGIN");
    await client.query(`SELECT id FROM ${getAzureQualifiedTableName("packing_messages")} WHERE id = $1 FOR UPDATE`, [messageId]);
    const [message] = await readMessages(messageId, client);
    if (!message || (message.authorId !== user.entraOid && message.recipientId !== user.entraOid)) {
      throw new MessageBoardError(404, "Message is no longer available.");
    }
    const result = await action(client, message);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

function requireDoneEditor(user: AuthenticatedUser, message: PackingMessage): void {
  if (user.role !== "editor") throw new MessageBoardError(403, "Read/Write access is required.");
  if (message.acknowledgments.length === 0) throw new MessageBoardError(409, "Only DONE messages can be changed.");
}

export async function resetPackingMessage(messageId: string, user: AuthenticatedUser): Promise<PackingMessage> {
  return withLockedMessage(messageId, user, async (client, message) => {
    requireDoneEditor(user, message);
    await client.query(`DELETE FROM ${getAzureQualifiedTableName("packing_message_acknowledgments")} WHERE message_id = $1`, [messageId]);
    const [updated] = await readMessages(messageId, client);
    return updated!;
  });
}

export async function removePackingMessage(messageId: string, user: AuthenticatedUser): Promise<void> {
  await withLockedMessage(messageId, user, async (client, message) => {
    requireDoneEditor(user, message);
    // Preserve stored content; removal is from the shared board, not permanent deletion.
    await client.query(`INSERT INTO ${getAzureQualifiedTableName("packing_message_removals")} (message_id, removed_by) VALUES ($1, $2)`, [messageId, user.entraOid]);
  });
}
