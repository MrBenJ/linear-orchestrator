import { describe, it, expect } from "vitest";
import { makeTestDb } from "../../test/helpers/testDb";
import { tickets, runs } from "@/db/schema";
import { appendLog, readLogs } from "./logs";

function seedRun(db: ReturnType<typeof makeTestDb>) {
  db.insert(tickets).values({
    id: "t1", linearIssueId: "i1", linearIdentifier: "ENG-1", linearTeamId: "team-1",
    linearProjectId: null, repoPath: "/tmp/r", harness: "claude-code", prompt: "p",
    metadata: null, createdAt: 1,
  }).run();
  db.insert(runs).values({ id: "r1", ticketId: "t1", status: "running", createdAt: 1 }).run();
}

describe("agent logs", () => {
  it("appends ordered chunks and reads them back as text", () => {
    const db = makeTestDb();
    seedRun(db);
    appendLog(db, "r1", 0, "stdout", Buffer.from("hello "));
    appendLog(db, "r1", 1, "stdout", Buffer.from("world"));

    const all = readLogs(db, "r1");
    expect(all.map((l) => l.text).join("")).toBe("hello world");
    expect(all.map((l) => l.seq)).toEqual([0, 1]);
  });

  it("reads only chunks at or after a given seq", () => {
    const db = makeTestDb();
    seedRun(db);
    appendLog(db, "r1", 0, "stdout", Buffer.from("a"));
    appendLog(db, "r1", 1, "stdout", Buffer.from("b"));
    appendLog(db, "r1", 2, "stdout", Buffer.from("c"));

    const tail = readLogs(db, "r1", 1);
    expect(tail.map((l) => l.text).join("")).toBe("bc");
  });
});
