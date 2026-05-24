import { describe, it, expect } from "vitest";
import { FakeLinearGateway } from "../../test/helpers/fakeLinear";
import { applyRunOutcome } from "./ticketActions";

const stateMap = { inProgress: "s-prog", inReview: "s-rev", done: "s-done" };

describe("applyRunOutcome", () => {
  it("transitions to done on a merged success", async () => {
    const linear = new FakeLinearGateway();
    await applyRunOutcome(linear, {
      issueId: "i1", teamId: "team-1", stateMap, needsHumanLabel: "lo:needs-human",
      outcome: { status: "success", prMerged: true },
    });
    expect(linear.stateUpdates).toEqual([{ issueId: "i1", stateId: "s-done" }]);
  });

  it("transitions to inReview on a non-merged success", async () => {
    const linear = new FakeLinearGateway();
    await applyRunOutcome(linear, {
      issueId: "i1", teamId: "team-1", stateMap, needsHumanLabel: "lo:needs-human",
      outcome: { status: "success", prMerged: false },
    });
    expect(linear.stateUpdates).toEqual([{ issueId: "i1", stateId: "s-rev" }]);
  });

  it("labels needs-human and comments on failure, without a state change", async () => {
    const linear = new FakeLinearGateway();
    await applyRunOutcome(linear, {
      issueId: "i1", teamId: "team-1", stateMap, needsHumanLabel: "lo:needs-human",
      outcome: { status: "failure", summary: "it broke", notes: "stack trace" },
    });
    expect(linear.stateUpdates).toEqual([]);
    expect(linear.labelAdds).toEqual([{ issueId: "i1", labelId: "label-lo:needs-human" }]);
    expect(linear.comments).toHaveLength(1);
    expect(linear.comments[0].body).toContain("it broke");
  });
});
