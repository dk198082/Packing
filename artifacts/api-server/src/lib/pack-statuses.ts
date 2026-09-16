import {
  getAzurePool,
  getAzureQualifiedTableName,
} from "@workspace/db/azure";

export interface SharedPackStatus {
  orderId: string;
  packStartedAt: string | null;
}

function serializePackStatus(status: {
  orderId: string;
  packStartedAt: Date | null;
}): SharedPackStatus {
  return {
    orderId: status.orderId,
    packStartedAt: status.packStartedAt?.toISOString() ?? null,
  };
}

export async function getSharedPackStatuses(): Promise<SharedPackStatus[]> {
  const table = getAzureQualifiedTableName("pack_statuses");
  const result = await getAzurePool().query<{
    order_id: string;
    pack_started_at: Date | null;
  }>(`SELECT order_id, pack_started_at FROM ${table}`);
  return result.rows.map((status) =>
    serializePackStatus({
      orderId: status.order_id,
      packStartedAt: status.pack_started_at,
    }),
  );
}

export async function saveSharedPackStatus(
  orderId: string,
  packStartedAt: Date | null,
): Promise<SharedPackStatus> {
  const table = getAzureQualifiedTableName("pack_statuses");
  const result = await getAzurePool().query<{
    order_id: string;
    pack_started_at: Date | null;
  }>(
    `
      INSERT INTO ${table} (order_id, pack_started_at)
      VALUES ($1, $2)
      ON CONFLICT (order_id)
      DO UPDATE SET pack_started_at = EXCLUDED.pack_started_at
      RETURNING order_id, pack_started_at
    `,
    [orderId, packStartedAt],
  );
  const status = result.rows[0];
  if (!status) throw new Error("Pack status was not returned after saving.");

  return serializePackStatus({
    orderId: status.order_id,
    packStartedAt: status.pack_started_at,
  });
}