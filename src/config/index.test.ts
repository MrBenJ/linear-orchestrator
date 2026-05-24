import { describe, it, expect } from "vitest";
import { parseConfig, resolveRepoPath, resolveStateMap } from "./index";
import { makeTestConfig } from "../../test/helpers/testConfig";

describe("config", () => {
  it("applies defaults for omitted fields", () => {
    const c = parseConfig({});
    expect(c.concurrencyCap).toBe(2);
    expect(c.defaultRunTimeoutMs).toBe(3_600_000);
    expect(c.orchestrationLabels.needsHuman).toBe("lo:needs-human");
  });

  it("resolves repo path from project mapping", () => {
    const c = makeTestConfig();
    expect(resolveRepoPath(c, "proj-1")).toBe("/tmp/repo");
    expect(resolveRepoPath(c, "unknown")).toBeUndefined();
    expect(resolveRepoPath(c, null)).toBeUndefined();
  });

  it("resolves state map from team mapping", () => {
    const c = makeTestConfig();
    expect(resolveStateMap(c, "team-1")?.inProgress).toBe("s-prog");
    expect(resolveStateMap(c, "unknown")).toBeUndefined();
  });
});
