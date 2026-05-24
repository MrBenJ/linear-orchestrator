import { describe, it, expect } from "vitest";
import { composeAgentPrompt } from "./promptTemplate";

describe("composeAgentPrompt", () => {
  const base = {
    userPrompt: "Implement foo in foo.ts.",
    repoPath: "/repo",
    worktreePath: "/wt/r1",
    branchName: "lo/ENG-1-abc",
    linearUrl: "https://linear.app/x/issue/ENG-1",
    acceptanceCriteria: ["foo works", "tests pass"],
    callbackUrl: "http://localhost:3000/api/runs/r1",
  };

  it("keeps the user prompt as the leading content", () => {
    const out = composeAgentPrompt(base);
    expect(out.startsWith("Implement foo in foo.ts.")).toBe(true);
  });

  it("appends operational context and the code-task + callback instructions", () => {
    const out = composeAgentPrompt(base);
    expect(out).toContain("/wt/r1");
    expect(out).toContain("lo/ENG-1-abc");
    expect(out).toContain("https://linear.app/x/issue/ENG-1");
    expect(out).toContain("- foo works");
    expect(out).toContain("/code-task");
    expect(out).toContain("http://localhost:3000/api/runs/r1/complete");
    expect(out).toContain("http://localhost:3000/api/runs/r1/heartbeat");
    expect(out).toContain("prMerged");
  });

  it("omits the acceptance-criteria block when there are none", () => {
    const out = composeAgentPrompt({ ...base, acceptanceCriteria: [] });
    expect(out).not.toContain("Acceptance criteria:");
  });
});
