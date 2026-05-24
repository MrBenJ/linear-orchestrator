import { describe, it, expect } from "vitest";
import { formatRunsTable, parseArgs } from "./client";

describe("CLI helpers", () => {
  it("parses the command and positional arg", () => {
    expect(parseArgs(["status"])).toEqual({ cmd: "status", arg: undefined, from: 0 });
    expect(parseArgs(["logs", "run-1", "--from", "5"])).toEqual({ cmd: "logs", arg: "run-1", from: 5 });
    expect(parseArgs(["kill", "run-2"])).toEqual({ cmd: "kill", arg: "run-2", from: 0 });
  });

  it("formats a runs table", () => {
    const out = formatRunsTable([
      { id: "run-1", status: "running", branchName: "lo/ENG-1-abc", startedAt: 1, createdAt: 1 },
    ]);
    expect(out).toContain("run-1");
    expect(out).toContain("running");
    expect(out).toContain("lo/ENG-1-abc");
  });

  it("formats an empty runs table", () => {
    expect(formatRunsTable([])).toContain("no active runs");
  });
});
