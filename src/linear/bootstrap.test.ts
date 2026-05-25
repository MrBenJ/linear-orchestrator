import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FakeLinearGateway } from "../../test/helpers/fakeLinear";
import { buildTeamStateMap, upsertTeamMapping } from "./bootstrap";

const cleanup: string[] = [];
afterEach(() => {
  for (const d of cleanup.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("buildTeamStateMap", () => {
  it("proposes a state map from the team's workflow states", async () => {
    const linear = new FakeLinearGateway();
    linear.states = [
      { id: "todo", name: "Todo", type: "unstarted", position: 1 },
      { id: "dev", name: "In Dev", type: "started", position: 2 },
      { id: "review", name: "Review", type: "started", position: 3 },
      { id: "done", name: "Done", type: "completed", position: 4 },
    ];
    const { stateMap, warnings } = await buildTeamStateMap(linear, "team-1");
    expect(stateMap).toEqual({ inProgress: "dev", inReview: "review", done: "done" });
    expect(warnings).toEqual([]);
  });
});

describe("upsertTeamMapping", () => {
  it("adds a team mapping to a config file, preserving other fields", () => {
    const dir = mkdtempSync(join(tmpdir(), "lo-cfg-"));
    cleanup.push(dir);
    const path = join(dir, "config.json");
    writeFileSync(path, JSON.stringify({ concurrencyCap: 3, projectMappings: [{ linearProjectId: "p", repoPath: "/r" }] }));

    upsertTeamMapping(path, "team-1", { inProgress: "dev", inReview: "review", done: "done" });

    const written = JSON.parse(readFileSync(path, "utf8"));
    expect(written.concurrencyCap).toBe(3);
    expect(written.projectMappings).toHaveLength(1);
    expect(written.teamMappings).toEqual([
      { linearTeamId: "team-1", stateMap: { inProgress: "dev", inReview: "review", done: "done" } },
    ]);
  });

  it("replaces an existing mapping for the same team", () => {
    const dir = mkdtempSync(join(tmpdir(), "lo-cfg-"));
    cleanup.push(dir);
    const path = join(dir, "config.json");
    writeFileSync(path, JSON.stringify({
      teamMappings: [{ linearTeamId: "team-1", stateMap: { inProgress: "old", inReview: "old", done: "old" } }],
    }));

    upsertTeamMapping(path, "team-1", { inProgress: "dev", inReview: "review", done: "done" });

    const written = JSON.parse(readFileSync(path, "utf8"));
    expect(written.teamMappings).toHaveLength(1);
    expect(written.teamMappings[0].stateMap.inProgress).toBe("dev");
  });
});
