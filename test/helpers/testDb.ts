import { createDb, type DB } from "@/db/client";

export function makeTestDb(): DB {
  return createDb(":memory:");
}
