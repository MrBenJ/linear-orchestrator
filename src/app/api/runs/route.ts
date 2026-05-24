import { handleListRuns } from "./readHandlers";
import { getDb } from "@/db/client";

export async function GET(): Promise<Response> {
  return handleListRuns({ db: getDb() });
}
