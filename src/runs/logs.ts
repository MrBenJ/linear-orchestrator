import { and, eq, gte } from "drizzle-orm";
import type { DB } from "@/db/client";
import { agentLogs } from "@/db/schema";

export type LogStream = "stdout" | "stderr";

export interface LogChunk {
  seq: number;
  ts: number;
  stream: LogStream;
  text: string;
}

export function appendLog(
  db: DB,
  runId: string,
  seq: number,
  stream: LogStream,
  chunk: Buffer,
): void {
  db.insert(agentLogs).values({ runId, seq, ts: Date.now(), stream, chunk }).run();
}

export function readLogs(db: DB, runId: string, fromSeq = 0): LogChunk[] {
  const rows = db
    .select()
    .from(agentLogs)
    .where(and(eq(agentLogs.runId, runId), gte(agentLogs.seq, fromSeq)))
    .orderBy(agentLogs.seq)
    .all();
  return rows.map((r) => ({
    seq: r.seq,
    ts: r.ts,
    stream: r.stream as LogStream,
    text: Buffer.from(r.chunk as Buffer).toString("utf8"),
  }));
}
