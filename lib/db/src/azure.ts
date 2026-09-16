import pg from "pg";

const { Pool } = pg;

let azurePool: pg.Pool | undefined;

const POSTGRES_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

function readRequiredEnv(name: string) {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`${name} is required for the Azure Postgres connection.`);
  }

  return value;
}

export function getAzureSchemaName() {
  const schema = readRequiredEnv("AZURE_PG_SCHEMA");

  if (!POSTGRES_IDENTIFIER.test(schema)) {
    throw new Error("AZURE_PG_SCHEMA must be a valid PostgreSQL identifier.");
  }

  return schema;
}

export function getAzureQualifiedTableName(tableName: string) {
  if (!POSTGRES_IDENTIFIER.test(tableName)) {
    throw new Error("Azure PostgreSQL table name must be a valid identifier.");
  }

  return `"${getAzureSchemaName()}"."${tableName}"`;
}

export function getAzurePool() {
  if (azurePool) return azurePool;

  azurePool = new Pool({
    host: readRequiredEnv("AZURE_PG_HOST"),
    port: Number(readRequiredEnv("AZURE_PG_PORT")),
    database: readRequiredEnv("AZURE_PG_DATABASE"),
    user: readRequiredEnv("AZURE_PG_SP_USER"),
    password: readRequiredEnv("AZURE_PG_PASSWORD"),

    ssl: {
      rejectUnauthorized: false,
    },

    max: 5,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    keepAlive: true,
  });

  return azurePool;
}

export async function closeAzurePool() {
  if (!azurePool) return;

  const pool = azurePool;
  azurePool = undefined;

  await pool.end();
}