import {
  getAzurePool,
  getAzureQualifiedTableName,
} from "@workspace/db/azure";

export interface SharedPackStatus {
  orderId: string;
  packStartedAt: string | null;
  packedAt: string | null;
}

function serializePackStatus(status: {
  orderId: string;
  packStartedAt: Date | null;
  packedAt: Date | null;
}): SharedPackStatus {
  return {
    orderId: status.orderId,
    packStartedAt: status.packStartedAt?.toISOString() ?? null,
    packedAt: status.packedAt?.toISOString() ?? null,
  };
}

let completionSchemaReady: Promise<unknown> | undefined;
async function ensureCompletionSchema(): Promise<void> {
  // Only extend the existing app-owned status table; never touch ERP tables.
  completionSchemaReady ??= getAzurePool().query(
    `ALTER TABLE ${getAzureQualifiedTableName("pack_statuses")} ADD COLUMN IF NOT EXISTS packed_at timestamptz`,
  ).catch(error => {
    completionSchemaReady = undefined;
    throw error;
  });
  await completionSchemaReady;
}

export async function getSharedPackStatuses(): Promise<SharedPackStatus[]> {
  await ensureCompletionSchema();
  const table = getAzureQualifiedTableName("pack_statuses");
  const result = await getAzurePool().query<{
    order_id: string;
    pack_started_at: Date | null;
    packed_at: Date | null;
  }>(`SELECT order_id, pack_started_at, packed_at FROM ${table}`);
  return result.rows.map((status) =>
    serializePackStatus({
      orderId: status.order_id,
      packStartedAt: status.pack_started_at,
      packedAt: status.packed_at,
    }),
  );
}

export async function saveSharedPackStatus(
  orderId: string,
  packStartedAt: Date | null,
  startOnly = false,
): Promise<SharedPackStatus> {
  await ensureCompletionSchema();
  const table = getAzureQualifiedTableName("pack_statuses");
  const result = await getAzurePool().query<{
    order_id: string;
    pack_started_at: Date | null;
    packed_at: Date | null;
  }>(
    `
      INSERT INTO ${table} AS existing (order_id, pack_started_at)
      VALUES ($1, $2)
      ON CONFLICT (order_id)
      DO UPDATE SET pack_started_at = ${startOnly ? "COALESCE(existing.pack_started_at, EXCLUDED.pack_started_at)" : "EXCLUDED.pack_started_at"}
      RETURNING order_id, pack_started_at, packed_at
    `,
    [orderId, packStartedAt],
  );
  const status = result.rows[0];
  if (!status) throw new Error("Pack status was not returned after saving.");

  return serializePackStatus({
    orderId: status.order_id,
    packStartedAt: status.pack_started_at,
    packedAt: status.packed_at,
  });
}

export async function markSharedOrderPacked(orderId: string): Promise<SharedPackStatus> {
  await ensureCompletionSchema();
  const table = getAzureQualifiedTableName("pack_statuses");
  const result = await getAzurePool().query<{
    order_id: string; pack_started_at: Date | null; packed_at: Date;
  }>(`
    INSERT INTO ${table} AS existing (order_id, packed_at)
    VALUES ($1, NOW())
    ON CONFLICT (order_id)
    DO UPDATE SET packed_at = COALESCE(existing.packed_at, EXCLUDED.packed_at)
    RETURNING order_id, pack_started_at, packed_at
  `, [orderId]);
  const status = result.rows[0];
  if (!status) throw new Error("Packed status was not returned after saving.");
  return serializePackStatus({
    orderId: status.order_id,
    packStartedAt: status.pack_started_at,
    packedAt: status.packed_at,
  });
}

export async function editSharedOrderPacked(orderId: string, packedAt: Date | null): Promise<SharedPackStatus> {
  await ensureCompletionSchema();
  const table = getAzureQualifiedTableName("pack_statuses");
  const result = await getAzurePool().query<{
    order_id: string; pack_started_at: Date | null; packed_at: Date | null;
  }>(`
    INSERT INTO ${table} (order_id, packed_at)
    VALUES ($1, $2)
    ON CONFLICT (order_id) DO UPDATE SET packed_at = EXCLUDED.packed_at
    RETURNING order_id, pack_started_at, packed_at
  `, [orderId, packedAt]);
  const status = result.rows[0];
  if (!status) throw new Error("Packed status was not returned after updating.");
  return serializePackStatus({
    orderId: status.order_id, packStartedAt: status.pack_started_at, packedAt: status.packed_at,
  });
}