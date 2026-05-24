import { z } from "zod";
import type { DB } from "@/db/client";
import type { Config } from "@/config/types";
import { resolveRepoPath, resolveStateMap } from "@/config";
import type { LinearGateway } from "@/linear/gateway";
import { createTicketAndRun } from "@/runs/service";

const ticketInputSchema = z.object({
  linearTeamId: z.string().min(1),
  linearProjectId: z.string().min(1).optional(),
  title: z.string().min(1),
  description: z.string().optional(),
  acceptanceCriteria: z.array(z.string()).optional(),
  prompt: z.string().min(1),
  harness: z.literal("claude-code"),
  labels: z.array(z.string()).optional(),
});

const bodySchema = z.object({ tickets: z.array(ticketInputSchema).min(1) });

export interface TicketsDeps {
  db: DB;
  config: Config;
  linear: LinearGateway;
}

function json(data: unknown, status: number): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function composeDescription(description: string | undefined, ac: string[] | undefined): string {
  const parts: string[] = [];
  if (description) parts.push(description);
  if (ac && ac.length > 0) {
    parts.push(["## Acceptance criteria", ...ac.map((a) => `- ${a}`)].join("\n"));
  }
  return parts.join("\n\n");
}

export async function handleCreateTickets(req: Request, deps: TicketsDeps): Promise<Response> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return json({ error: "invalid JSON body" }, 400);
  }

  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) return json({ error: parsed.error.flatten() }, 400);

  // Pre-validate every ticket's mappings BEFORE creating anything (atomic intake).
  const resolved = [];
  for (const t of parsed.data.tickets) {
    const stateMap = resolveStateMap(deps.config, t.linearTeamId);
    if (!stateMap) return json({ error: `no state mapping for team ${t.linearTeamId}` }, 400);
    const repoPath = resolveRepoPath(deps.config, t.linearProjectId ?? null);
    if (!repoPath) {
      return json({ error: `no repo mapping for project ${t.linearProjectId ?? "(none)"}` }, 400);
    }
    resolved.push({ t, stateMap, repoPath });
  }

  const results = [];
  for (const { t, stateMap, repoPath } of resolved) {
    const issue = await deps.linear.createIssue({
      teamId: t.linearTeamId,
      projectId: t.linearProjectId,
      title: t.title,
      description: composeDescription(t.description, t.acceptanceCriteria),
    });

    const { ticketId, runId } = createTicketAndRun(deps.db, {
      linearIssueId: issue.id,
      linearIdentifier: issue.identifier,
      linearTeamId: t.linearTeamId,
      linearProjectId: t.linearProjectId ?? null,
      repoPath,
      harness: t.harness,
      prompt: t.prompt,
      metadata: {
        title: t.title,
        description: t.description,
        acceptanceCriteria: t.acceptanceCriteria,
        labels: t.labels,
      },
    });

    await deps.linear.updateIssueState(issue.id, stateMap.inProgress);
    results.push({
      id: ticketId,
      linearUrl: issue.url,
      linearIdentifier: issue.identifier,
      runId,
    });
  }

  return json({ tickets: results }, 200);
}
