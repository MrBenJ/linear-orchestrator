import { parseConfig, type Config } from "@/config";

export function makeTestConfig(overrides: Partial<Config> = {}): Config {
  return parseConfig({
    projectMappings: [{ linearProjectId: "proj-1", repoPath: "/tmp/repo" }],
    teamMappings: [
      { linearTeamId: "team-1", stateMap: { inProgress: "s-prog", inReview: "s-rev", done: "s-done" } },
    ],
    ...overrides,
  });
}
