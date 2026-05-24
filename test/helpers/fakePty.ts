import type { PtyHandle, PtySpawner, PtySpawnOptions } from "@/worker/pty";

export class FakePtyHandle implements PtyHandle {
  pid = 9999;
  killed: string | undefined;
  private dataCbs: Array<(d: string) => void> = [];
  private exitCbs: Array<(e: { exitCode: number; signal?: number }) => void> = [];

  onData(cb: (data: string) => void): void {
    this.dataCbs.push(cb);
  }
  onExit(cb: (e: { exitCode: number; signal?: number }) => void): void {
    this.exitCbs.push(cb);
  }
  write(): void {}
  kill(signal?: string): void {
    this.killed = signal ?? "SIGTERM";
  }

  emitData(data: string): void {
    for (const cb of this.dataCbs) cb(data);
  }
  emitExit(exitCode: number, signal?: number): void {
    for (const cb of this.exitCbs) cb({ exitCode, signal });
  }
}

export class FakePtySpawner implements PtySpawner {
  lastHandle: FakePtyHandle | undefined;
  lastSpawn: { file: string; args: string[]; opts: PtySpawnOptions } | undefined;

  spawn(file: string, args: string[], opts: PtySpawnOptions): PtyHandle {
    const handle = new FakePtyHandle();
    this.lastHandle = handle;
    this.lastSpawn = { file, args, opts };
    return handle;
  }
}
