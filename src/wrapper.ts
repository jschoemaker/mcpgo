import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

type WrapperOptions = {
  name?: string;
  pidfile?: string;
  cwd?: string;
  respawnMs: number;
  maxBackoffMs: number;
};

function parseArgs(argv: string[]): { opts: WrapperOptions; child: { command: string; args: string[] } } {
  const defaultPidfile = path.join(os.tmpdir(), "mcpmanager", "pids", "mcp.pid");
  const opts: WrapperOptions = {
    respawnMs: 250,
    maxBackoffMs: 5000,
    pidfile: defaultPidfile,
  };

  const sep = argv.indexOf("--");
  const args = sep >= 0 ? argv.slice(0, sep) : argv;
  const childArgs = sep >= 0 ? argv.slice(sep + 1) : [];

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--name") {
      opts.name = args[++i];
    } else if (a === "--pidfile") {
      opts.pidfile = args[++i];
    } else if (a === "--cwd") {
      opts.cwd = args[++i];
    } else if (a === "--respawn-ms") {
      opts.respawnMs = Number(args[++i]);
    } else if (a === "--max-backoff-ms") {
      opts.maxBackoffMs = Number(args[++i]);
    }
  }

  if (childArgs.length === 0) {
    throw new Error("Missing child command; pass it after '--'");
  }
  const [command, ...rest] = childArgs;
  return { opts, child: { command, args: rest } };
}

async function writePid(pidfile: string | undefined, pid: number): Promise<void> {
  if (!pidfile) return;
  const dir = path.dirname(pidfile);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(pidfile, String(pid), "utf-8");
}

async function clearPid(pidfile: string | undefined): Promise<void> {
  if (!pidfile) return;
  try {
    await fs.unlink(pidfile);
  } catch {
    // ignore
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const { opts, child } = parseArgs(process.argv.slice(2));
  const label = opts.name ? `[mcp-wrapper:${opts.name}]` : "[mcp-wrapper]";

  let shuttingDown = false;
  let backoff = opts.respawnMs;
  let currentChild: ReturnType<typeof spawn> | null = null;

  async function stopChild(timeoutMs = 2000): Promise<void> {
    const proc = currentChild;
    if (!proc || proc.killed) return;

    try {
      proc.kill("SIGTERM");
    } catch {
      // ignore
    }

    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (proc.exitCode !== null) return;
      await delay(50);
    }

    try {
      proc.kill("SIGKILL");
    } catch {
      // ignore
    }
  }

  async function spawnChild(): Promise<void> {
    const startedAt = Date.now();
    const shellCommands = new Set(["cmd", "cmd.exe", "bash", "sh", "pwsh", "powershell"]);
    const needsShell = process.platform === "win32" &&
      !shellCommands.has(child.command.split(/[/\\]/).pop()?.toLowerCase() ?? "");
    const proc = spawn(child.command, child.args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: process.env,
      cwd: opts.cwd ?? process.cwd(),
      windowsHide: true,
      shell: needsShell,
    });
    currentChild = proc;

    if (typeof proc.pid === "number") {
      await writePid(opts.pidfile, proc.pid);
    }

    process.stdin.pipe(proc.stdin);
    proc.stdout.pipe(process.stdout);
    proc.stderr.pipe(process.stderr);

    proc.on("error", async (err) => {
      process.stderr.write(`${label} child spawn error: ${err}\n`);
      await clearPid(opts.pidfile);
      process.exit(1);
    });

    proc.on("exit", async (code, signal) => {
      process.stdin.unpipe(proc.stdin);
      proc.stdout.unpipe(process.stdout);
      proc.stderr.unpipe(process.stderr);
      await clearPid(opts.pidfile);

      if (shuttingDown) {
        process.stderr.write(`${label} child exited (code=${code}, signal=${signal}); shutting down\n`);
        process.exit(code ?? 0);
        return;
      }

      // If the child stayed up for a while, reset backoff to the base.
      if (Date.now() - startedAt > 10_000) {
        backoff = opts.respawnMs;
      }

      process.stderr.write(`${label} child exited (code=${code}, signal=${signal}); respawning in ${backoff}ms\n`);
      await delay(backoff);
      backoff = Math.min(opts.maxBackoffMs, Math.max(250, backoff * 2));
      await spawnChild();
    });
  }

  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    process.stderr.write(`${label} shutting down...\n`);
    await stopChild();
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  process.stdin.on("end", shutdown);

  await spawnChild();
}

main().catch((err) => {
  process.stderr.write(`[mcp-wrapper] fatal: ${err}\n`);
  process.exit(1);
});
