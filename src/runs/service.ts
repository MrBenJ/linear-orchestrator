import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { DB } from "@/db/client";
import { tickets, runs } from "@/db/schema";

export interface NewTicketInput {
  linearIssueId: string;
  linearIdentifier: string;
  linearTeamId: string;
  linearProjectId: string | null;
  repoPath: string;
  harness: string;
  prompt: string;
  metadata: unknown;
}

export interface CreatedTicketRun {
  ticketId: string;
  runId: string;
}

export function createTicketAndRun(db: DB, input: NewTicketInput): CreatedTicketRun {
  const ticketId = randomUUID();
  const runId = randomUUID();
  const now = Date.now();

  db.transaction((tx) => {
    tx.insert(tickets)
      .values({
        id: ticketId,
        linearIssueId: input.linearIssueId,
        linearIdentifier: input.linearIdentifier,
        linearTeamId: input.linearTeamId,
        linearProjectId: input.linearProjectId,
        repoPath: input.repoPath,
        harness: input.harness,
        prompt: input.prompt,
        metadata: JSON.stringify(input.metadata ?? null),
        createdAt: now,
      })
      .run();

    tx.insert(runs)
      .values({ id: runId, ticketId, status: "queued", createdAt: now })
      .run();
  });

  return { ticketId, runId };
}

export function getRun(db: DB, runId: string) {
  return db.select().from(runs).where(eq(runs.id, runId)).get();
}
