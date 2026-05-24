import { timingSafeEqual } from "node:crypto";
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
  apiToken: string;
}

interface CreatedTicketResult {
  id: string;
  linearUrl: string;
  linearIdentifier: string;
  runId: string;
  stateTransitioned: boolean;
  warning?: string;
}

interface TicketError {
  title: string;
  error: string;
  orphanedIssueId?: string;
}

function json(data: unknown, status: number): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function constantTimeEquals(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
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
  // Auth gate: the intake endpoint creates Linear issues and queues runs, so it
  // must not be an open mutation surface (reachable via localhost POSTs or a
  // tunnel that forwards all paths). Require a bearer token before anything else.
  const auth = req.headers.get("authorization");
  if (!auth || !constantTimeEquals(auth, `Bearer ${deps.apiToken}`)) {
    return json({ error: "unauthorized" }, 401);
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return json({ error: "invalid JSON body" }, 400);
  }

  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) return json({ error: parsed.error.flatten() }, 400);

  // Pre-validate every ticket's mappings BEFORE creating anything, so a bad
  // mapping rejects the whole request without partial side effects.
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

  // True atomicity across an external API (Linear) and the local DB is not
  // possible, so intake is explicit per-ticket partial-success: each ticket
  // either lands fully (issue + persisted run) or is reported in `errors`.
  const created: CreatedTicketResult[] = [];
  const errors: TicketError[] = [];

  for (const { t, stateMap, repoPath } of resolved) {
    let issue;
    try {
      issue = await deps.linear.createIssue({
        teamId: t.linearTeamId,
        projectId: t.linearProjectId,
        title: t.title,
        description: composeDescription(t.description, t.acceptanceCriteria),
      });
    } catch (e) {
      errors.push({ title: t.title, error: `create issue failed: ${(e as Error).message}` });
      continue;
    }

    let ticketId: string;
    let runId: string;
    try {
      ({ ticketId, runId } = createTicketAndRun(deps.db, {
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
      }));
    } catch (e) {
      // Issue exists in Linear but we failed to record it — surface the orphan
      // id rather than silently losing track of it.
      errors.push({
        title: t.title,
        error: `persist failed: ${(e as Error).message}`,
        orphanedIssueId: issue.id,
      });
      continue;
    }

    // The ticket + queued run are now durable. A failed initial transition is
    // non-fatal: returning an error here would invite a client retry that
    // creates a duplicate Linear issue. The worker re-asserts inProgress on
    // start, so we record a warning and report the ticket as created.
    let stateTransitioned = true;
    let warning: string | undefined;
    try {
      await deps.linear.updateIssueState(issue.id, stateMap.inProgress);
    } catch (e) {
      stateTransitioned = false;
      warning = `state transition failed: ${(e as Error).message}; run persisted, worker will re-assert`;
    }

    created.push({
      id: ticketId,
      linearUrl: issue.url,
      linearIdentifier: issue.identifier,
      runId,
      stateTransitioned,
      ...(warning ? { warning } : {}),
    });
  }

  return json({ tickets: created, errors }, errors.length > 0 ? 502 : 200);
}
