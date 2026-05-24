import { describe, it, expect } from "vitest";
import { FakePtySpawner } from "./fakePty";

describe("FakePtySpawner", () => {
  it("captures spawn args and replays data + exit to listeners", () => {
    const spawner = new FakePtySpawner();
    const h = spawner.spawn("claude-code", ["-p", "hi"], { cwd: "/wt", env: {} });
    expect(spawner.lastSpawn?.file).toBe("claude-code");

    let seen = "";
    let exit = -1;
    h.onData((d) => (seen += d));
    h.onExit((e) => (exit = e.exitCode));
    spawner.lastHandle!.emitData("output");
    spawner.lastHandle!.emitExit(0);
    expect(seen).toBe("output");
    expect(exit).toBe(0);
  });
});
