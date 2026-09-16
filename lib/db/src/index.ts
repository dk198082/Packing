import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

const azureConfig = {
  host: process.env.AZURE_PG_HOST,
  port: Number(process.env.AZURE_PG_PORT ?? 5432),
  database: process.env.AZURE_PG_DATABASE,
  user: process.env.AZURE_PG_USER ?? process.env.AZURE_PG_SP_USER,
  password: process.env.AZURE_PG_PASSWORD,
};

const hasAzureConfig = Object.values(azureConfig).every(Boolean);

if (!process.env.DATABASE_URL && !hasAzureConfig) {
  throw new Error(
    "DATABASE_URL or the Azure PostgreSQL connection secrets must be set.",
  );
}

const sslMode = process.env.AZURE_PG_SSLMODE?.toLowerCase();

export const pool = hasAzureConfig
  ? new Pool({
      ...azureConfig,
      ssl:
        sslMode === "disable"
          ? false
          : { rejectUnauthorized: false },
      connectionTimeoutMillis: 15_000,
      idleTimeoutMillis: 30_000,
      max: 5,
    })
  : new Pool({
      connectionString: process.env.DATABASE_URL,
    });

export const db = drizzle(pool, { schema });

export * from "./schema";