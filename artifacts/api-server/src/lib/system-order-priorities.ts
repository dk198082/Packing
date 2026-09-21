import {
  getAzurePool,
  getAzureQualifiedTableName,
  type AzurePoolClient,
} from "@workspace/db/azure";

export interface SystemOrderPriority {
  orderId: string;
  priority: number;
}

export interface SystemOrderPrioritySchedule {
  priorities: Map<string, number>;
  revision: string | null;
}

const PRIORITY_LOCK_KEY = "packing-control-board.system-order-priorities";

async function lockPrioritySchedule(client: AzurePoolClient) {
  await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
    PRIORITY_LOCK_KEY,
  ]);
}

async function getRevision(client: AzurePoolClient, orderIds: string[]) {
  if (orderIds.length === 0) return null;
  const table = getAzureQualifiedTableName("system_order_priorities");
  const result = await client.query<{ revision: Date | null }>(
    `
      SELECT MAX(updated_at) AS revision
      FROM ${table}
      WHERE order_id = ANY($1::text[])
    `,
    [orderIds],
  );
  return result.rows[0]?.revision?.toISOString() ?? null;
}

async function savePriorities(
  client: AzurePoolClient,
  orderIds: string[],
): Promise<SystemOrderPriority[]> {
  if (orderIds.length === 0) return [];

  const table = getAzureQualifiedTableName("system_order_priorities");
  const priorities = orderIds.map((_, index) => index + 1);
  const result = await client.query<{
    order_id: string;
    priority: number;
  }>(
    `
      INSERT INTO ${table} (order_id, priority, updated_at)
      SELECT order_id, priority, NOW()
      FROM unnest($1::text[], $2::integer[]) AS input_values(order_id, priority)
      ON CONFLICT (order_id)
      DO UPDATE SET
        priority = EXCLUDED.priority,
        updated_at = EXCLUDED.updated_at
      RETURNING order_id, priority
    `,
    [orderIds, priorities],
  );

  return result.rows
    .map(({ order_id, priority }) => ({ orderId: order_id, priority }))
    .sort((a, b) => a.priority - b.priority);
}

async function appendMissingPriorities(
  client: AzurePoolClient,
  orderIds: string[],
): Promise<SystemOrderPriority[]> {
  if (orderIds.length === 0) return [];

  const table = getAzureQualifiedTableName("system_order_priorities");
  const maxPriorityResult = await client.query<{ max_priority: number }>(
    `
      SELECT COALESCE(MAX(priority), 0)::integer AS max_priority
      FROM ${table}
    `,
  );
  const maxPriority = maxPriorityResult.rows[0]?.max_priority ?? 0;
  const priorities = orderIds.map((_, index) => maxPriority + index + 1);
  const result = await client.query<{
    order_id: string;
    priority: number;
  }>(
    `
      INSERT INTO ${table} (order_id, priority, updated_at)
      SELECT order_id, priority, NOW()
      FROM unnest($1::text[], $2::integer[]) AS input_values(order_id, priority)
      ON CONFLICT (order_id) DO NOTHING
      RETURNING order_id, priority
    `,
    [orderIds, priorities],
  );

  return result.rows.map(({ order_id, priority }) => ({
    orderId: order_id,
    priority,
  }));
}

export async function getOrCreateSystemOrderPriorities(
  orderIds: string[],
): Promise<SystemOrderPrioritySchedule> {
  if (orderIds.length === 0) {
    return { priorities: new Map(), revision: null };
  }

  const client = await getAzurePool().connect();
  const table = getAzureQualifiedTableName("system_order_priorities");
  try {
    await client.query("BEGIN");
    await lockPrioritySchedule(client);
    const result = await client.query<{
      order_id: string;
      priority: number;
    }>(
      `
        SELECT order_id, priority
        FROM ${table}
        WHERE order_id = ANY($1::text[])
        FOR UPDATE
      `,
      [orderIds],
    );

    const storedPriority = new Map(
      result.rows.map(({ order_id, priority }) => [order_id, priority]),
    );
    const missingOrderIds = orderIds.filter(
      (orderId) => !storedPriority.has(orderId),
    );
    const appended = await appendMissingPriorities(client, missingOrderIds);
    const saved = [
      ...result.rows.map(({ order_id, priority }) => ({
        orderId: order_id,
        priority,
      })),
      ...appended,
    ];
    const revision = await getRevision(client, orderIds);
    await client.query("COMMIT");
    return {
      priorities: new Map(
        saved.map(({ orderId, priority }) => [orderId, priority]),
      ),
      revision,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function replaceSystemOrderPriorities(
  orderIds: string[],
  expectedRevision: string | null,
): Promise<{ priorities: SystemOrderPriority[]; revision: string | null }> {
  const client = await getAzurePool().connect();
  const table = getAzureQualifiedTableName("system_order_priorities");
  try {
    await client.query("BEGIN");
    await lockPrioritySchedule(client);
    const currentRevision = await getRevision(client, orderIds);
    if (currentRevision !== expectedRevision) {
      await client.query("ROLLBACK");
      return { priorities: [], revision: currentRevision };
    }

    await client.query(
      `
        DELETE FROM ${table}
        WHERE NOT (order_id = ANY($1::text[]))
      `,
      [orderIds],
    );
    const priorities = await savePriorities(client, orderIds);
    const revision = await getRevision(client, orderIds);
    await client.query("COMMIT");
    return { priorities, revision };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}