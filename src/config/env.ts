import dotenv from "dotenv";

dotenv.config();

export interface ShardDbConfig {
  id: number;
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
}

export interface GcsConfig {
  bucketName: string;
  projectId?: string | undefined;
}

export interface AppConfig {
  port: number;
  batchSize: number;
  shards: ShardDbConfig[];
  gcs: GcsConfig;
}

function getEnvNumber(key: string, defaultValue?: number): number {
  const value = process.env[key];
  if (!value) {
    if (defaultValue !== undefined) {
      return defaultValue;
    }
    throw new Error(
      `Environment variable "${key}" is required and must be a number.`,
    );
  }
  const parsed = parseInt(value, 10);
  if (isNaN(parsed)) {
    throw new Error(
      `Environment variable "${key}" must be a valid integer, received: "${value}"`,
    );
  }
  return parsed;
}

function getEnvString(key: string, defaultValue?: string): string {
  const value = process.env[key];
  if (!value) {
    if (defaultValue !== undefined) {
      return defaultValue;
    }
    throw new Error(`Environment variable "${key}" is required.`);
  }
  return value;
}

export const env: AppConfig = {
  port: getEnvNumber("PORT", 3000),
  batchSize: getEnvNumber("DB_BATCH_SIZE", 500),
  shards: [
    {
      id: 0,
      host: getEnvString("DB_SHARD_0_HOST", "localhost"),
      port: getEnvNumber("DB_SHARD_0_PORT", 5433),
      database: getEnvString("DB_SHARD_0_NAME", "orders"),
      user: getEnvString("DB_SHARD_0_USER", "postgres"),
      password: getEnvString("DB_SHARD_0_PASSWORD", "postgres"),
    },
    {
      id: 1,
      host: getEnvString("DB_SHARD_1_HOST", "localhost"),
      port: getEnvNumber("DB_SHARD_1_PORT", 5434),
      database: getEnvString("DB_SHARD_1_NAME", "orders"),
      user: getEnvString("DB_SHARD_1_USER", "postgres"),
      password: getEnvString("DB_SHARD_1_PASSWORD", "postgres"),
    },
    {
      id: 2,
      host: getEnvString("DB_SHARD_2_HOST", "localhost"),
      port: getEnvNumber("DB_SHARD_2_PORT", 5435),
      database: getEnvString("DB_SHARD_2_NAME", "orders"),
      user: getEnvString("DB_SHARD_2_USER", "postgres"),
      password: getEnvString("DB_SHARD_2_PASSWORD", "postgres"),
    },
  ],
  gcs: {
    bucketName: process.env.GCS_BUCKET_NAME || "",
    projectId: process.env.GCP_PROJECT_ID || undefined,
  },
};

