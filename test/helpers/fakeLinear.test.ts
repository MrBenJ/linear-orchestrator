import { describe, it, expect } from "vitest";
import { FakeLinearGateway } from "./fakeLinear";

describe("FakeLinearGateway", () => {
  it("records createIssue calls and returns the configured issue", async () => {
    const fake = new FakeLinearGateway();
    const issue = await fake.createIssue({ teamId: "team-1", title: "x" });
    expect(issue.identifier).toBe("ENG-1");
    expect(fake.createdIssues).toHaveLength(1);
  });

  it("throws when failCreate is set", async () => {
    const fake = new FakeLinearGateway();
    fake.failCreate = true;
    await expect(fake.createIssue({ teamId: "team-1", title: "x" })).rejects.toThrow();
  });
});
