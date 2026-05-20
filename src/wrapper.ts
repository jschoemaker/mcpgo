import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import os from "node:os";
import path from "node:path";

type WrapperOptions = {
  name?: string;
  pidfile?: string;
  cwd?: string;
  respawnMs: number;
  maxBackoffMs: number;
  envAllowSpec?: string[];
};

function parseArgs(argv: string[]): { opts: WrapperOptions; child: { command: string; args: string[] } } {
  const defaultPidfile = path.join(os.tmpdir(), "mcpgo", "pids", "mcp.pid");
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
    } else if (a === "--env-allowlist") {
      opts.envAllowSpec = (args[++i] || "").split(",").map((s) => s.trim()).filter(Boolean);
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

/**
 * Resolve a command name to an absolute executable path using PATH (and
 * PATHEXT on Windows). Returns the original command unchanged if it already
 * contains a path separator or no candidate is found. Replaces the old
 * `shell: true` Windows path, which let cmd.exe re-parse args (and child
 * metacharacters) at spawn time.
 */
function resolveExecutable(command: string, env: NodeJS.ProcessEnv): string {
  if (command.includes("/") || command.includes("\\")) return command;
  const pathEntries = (env.PATH || env.Path || "").split(path.delimiter).filter(Boolean);
  const exts = process.platform === "win32"
    ? (env.PATHEXT || ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean)
    : [""];
  const hasExt = process.platform === "win32" && /\.[^.\\/]+$/.test(command);
  for (const dir of pathEntries) {
    if (hasExt) {
      const candidate = path.join(dir, command);
      if (fsSync.existsSync(candidate)) return candidate;
      continue;
    }
    for (const ext of exts) {
      const candidate = path.join(dir, command + ext);
      if (fsSync.existsSync(candidate)) return candidate;
    }
  }
  return command;
}

/**
 * Filter process env by an allowlist. Entries ending in "*" are prefix
 * matches (e.g. "LC_*" allows LC_ALL, LC_CTYPE). Env var names are
 * case-insensitive on Windows; case-sensitive elsewhere.
 */
function filterEnv(source: NodeJS.ProcessEnv, allowSpec: readonly string[]): NodeJS.ProcessEnv {
  const ci = process.platform === "win32";
  const norm = (s: string) => (ci ? s.toUpperCase() : s);
  const exact = new Set<string>();
  const prefixes: string[] = [];
  for (const item of allowSpec) {
    if (item.endsWith("*")) prefixes.push(norm(item.slice(0, -1)));
    else exact.add(norm(item));
  }
  const out: NodeJS.ProcessEnv = {};
  for (const [key, val] of Object.entries(source)) {
    if (val === undefined) continue;
    const n = norm(key);
    if (exact.has(n) || prefixes.some((p) => n.startsWith(p))) out[key] = val;
  }
  return out;
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
    const childEnv = opts.envAllowSpec
      ? filterEnv(process.env, opts.envAllowSpec)
      : process.env;
    const resolved = resolveExecutable(child.command, childEnv);
    // Node ≥ 18.20 / 20.12 refuses to spawn .cmd / .bat files without a shell
    // (CVE-2024-27980). Use `shell: true` only for that narrow case — Node
    // applies its own cmd-quoting for the args we pass. Everything else
    // spawns with shell: false to avoid cmd.exe re-parsing arg metachars.
    const needsCmdShell = process.platform === "win32" && /\.(cmd|bat)$/i.test(resolved);
    const proc = spawn(resolved, child.args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: childEnv,
      cwd: opts.cwd ?? process.cwd(),
      windowsHide: true,
      shell: needsCmdShell,
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
