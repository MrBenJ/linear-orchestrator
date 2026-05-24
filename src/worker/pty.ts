import * as nodePty from "node-pty";

export interface PtyHandle {
  readonly pid: number;
  onData(cb: (data: string) => void): void;
  onExit(cb: (e: { exitCode: number; signal?: number }) => void): void;
  write(data: string): void;
  kill(signal?: string): void;
}

export interface PtySpawnOptions {
  cwd: string;
  env: NodeJS.ProcessEnv;
}

export interface PtySpawner {
  spawn(file: string, args: string[], opts: PtySpawnOptions): PtyHandle;
}

export class NodePtySpawner implements PtySpawner {
  spawn(file: string, args: string[], opts: PtySpawnOptions): PtyHandle {
    const proc = nodePty.spawn(file, args, {
      name: "xterm-color",
      cols: 120,
      rows: 40,
      cwd: opts.cwd,
      env: opts.env as { [key: string]: string },
    });
    return {
      pid: proc.pid,
      onData: (cb) => proc.onData(cb),
      onExit: (cb) => proc.onExit(({ exitCode, signal }) => cb({ exitCode, signal })),
      write: (data) => proc.write(data),
      kill: (signal) => proc.kill(signal),
    };
  }
}
