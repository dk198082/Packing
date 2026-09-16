import {
  getAzurePool,
  getAzureQualifiedTableName,
} from "@workspace/db/azure";

interface InPackingSeed {
  orderId: string;
  sourceModifiedAt: string;
}

function getSeedDate(sourceModifiedAt: string): Date {
  const candidate = new Date(sourceModifiedAt);
  return Number.isNaN(candidate.getTime()) ? new Date() : candidate;
}

export async function getOrCreateInPackingEntryTimes(
  seeds: InPackingSeed[],
): Promise<Map<string, string>> {
  if (seeds.length === 0) return new Map();

  const table = getAzureQualifiedTableName("in_packing_entries");
  const orderIds = seeds.map(({ orderId }) => orderId);
  const enteredPackingAt = seeds.map(({ sourceModifiedAt }) =>
    getSeedDate(sourceModifiedAt),
  );

  await getAzurePool().query(
    `
      INSERT INTO ${table} (order_id, entered_packing_at)
      SELECT *
      FROM unnest($1::text[], $2::timestamptz[])
      ON CONFLICT (order_id) DO NOTHING
    `,
    [orderIds, enteredPackingAt],
  );

  const result = await getAzurePool().query<{
    order_id: string;
    entered_packing_at: Date;
  }>(
    `
      SELECT order_id, entered_packing_at
      FROM ${table}
      WHERE order_id = ANY($1::text[])
    `,
    [orderIds],
  );

  return new Map(
    result.rows.map((entry) => [
      entry.order_id,
      entry.entered_packing_at.toISOString(),
    ]),
  );
}