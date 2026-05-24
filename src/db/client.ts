import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from "./schema";

export type DB = BetterSQLite3Database<typeof schema>;

const MIGRATIONS_FOLDER = join(process.cwd(), "drizzle");

export function createDb(dbPath: string): DB {
  if (dbPath !== ":memory:") mkdirSync(dirname(dbPath), { recursive: true });
  const sqlite = new Database(dbPath);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  return db;
}

let cached: DB | undefined;

export function getDb(): DB {
  if (!cached) {
    const home = process.env.HOME ?? process.cwd();
    const dbPath = process.env.LO_DB_PATH ?? join(home, ".linear-orchestrator", "state.db");
    cached = createDb(dbPath);
  }
  return cached;
}
