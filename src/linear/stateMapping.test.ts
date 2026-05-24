import { describe, it, expect } from "vitest";
import { proposeStateMap, validateStateMap } from "./stateMapping";
import type { WorkflowState } from "./gateway";

const states: WorkflowState[] = [
  { id: "backlog", name: "Backlog", type: "backlog", position: 0 },
  { id: "todo", name: "Todo", type: "unstarted", position: 1 },
  { id: "dev", name: "In Dev", type: "started", position: 2 },
  { id: "review", name: "Code Review", type: "started", position: 3 },
  { id: "shipped", name: "Shipped", type: "completed", position: 4 },
];

describe("proposeStateMap", () => {
  it("maps inProgress/inReview/done by type and position", () => {
    const { stateMap, warnings } = proposeStateMap(states);
    expect(stateMap).toEqual({ inProgress: "dev", inReview: "review", done: "shipped" });
    expect(warnings).toHaveLength(0);
  });

  it("falls back inReview to inProgress when only one started state exists", () => {
    const single = states.filter((s) => s.id !== "review");
    const { stateMap, warnings } = proposeStateMap(single);
    expect(stateMap.inReview).toBe("dev");
    expect(warnings.join(" ")).toContain("inReview falls back");
  });
});

describe("validateStateMap", () => {
  it("throws when a state id is not a known workflow state", () => {
    expect(() =>
      validateStateMap({ inProgress: "dev", inReview: "review", done: "ghost" }, states),
    ).toThrow(/done/);
  });

  it("passes for a fully-resolved valid map", () => {
    expect(() =>
      validateStateMap({ inProgress: "dev", inReview: "review", done: "shipped" }, states),
    ).not.toThrow();
  });
});
