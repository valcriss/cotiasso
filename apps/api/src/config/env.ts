export interface AppEnv {
  databaseUrl: string;
  host: string;
  port: number;
}

export function readEnv(source: NodeJS.ProcessEnv = process.env): AppEnv {
  const databaseUrl = source.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL est obligatoire (voir .env.example).");
  }
  const port = Number(source.API_PORT ?? "3000");
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`API_PORT invalide : ${source.API_PORT}`);
  }
  return { databaseUrl, host: source.API_HOST ?? "127.0.0.1", port };
}
