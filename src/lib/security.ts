import os from "node:os";
import path from "node:path";

const MCP_NAME_RE = /^[a-zA-Z0-9_-]+$/;

export class InvalidMcpNameError extends Error {
  constructor(public name: string) {
    super(`Invalid MCP name '${name}'. Use only alphanumeric characters, dashes, and underscores.`);
  }
}

export function assertValidMcpName(name: unknown): asserts name is string {
  if (typeof name !== "string" || !MCP_NAME_RE.test(name)) {
    throw new InvalidMcpNameError(String(name));
  }
}

export function nameErrorResponse(name: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify({
          success: false,
          message: `Invalid MCP name '${String(name)}'. Use only alphanumeric characters, dashes, and underscores.`,
          error: "Invalid name",
        }),
      },
    ],
  };
}

/** Canonical pidfile location written by current code (kind="claude") and codex wrap (kind="codex"). */
export function canonicalPidfile(name: string, kind: "claude" | "codex" = "claude"): string {
  const filename = kind === "codex" ? `codex.${name}.pid` : `${name}.pid`;
  if (process.platform === "win32") {
    const base = process.env.LOCALAPPDATA || os.tmpdir();
    return path.join(base, "mcpgo", "pids", filename);
  }
  return path.join(os.tmpdir(), "mcpgo", "pids", filename);
}

/**
 * Returns the set of directories that are allowed to contain mcpgo-managed pidfiles.
 * Includes the legacy `mcpmanager` directory for backwards compat with MCPs wrapped
 * before the rename.
 */
function allowedPidfileDirs(): string[] {
  const dirs: string[] = [];
  if (process.platform === "win32") {
    const base = process.env.LOCALAPPDATA || os.tmpdir();
    dirs.push(path.join(base, "mcpgo", "pids"));
    dirs.push(path.join(base, "mcpmanager", "pids"));
  } else {
    dirs.push(path.join(os.tmpdir(), "mcpgo", "pids"));
    dirs.push(path.join(os.tmpdir(), "mcpmanager", "pids"));
  }
  return dirs;
}

/**
 * Reject pidfile paths that are not inside a known mcpgo pidfile directory
 * with the expected `<name>.pid` (or `codex.<name>.pid`) filename. Defeats
 * arbitrary-PID kill / file delete via a crafted MCP config entry.
 */
export function isAllowedPidfilePath(
  claimed: string,
  name: string,
  kind: "claude" | "codex" = "claude"
): boolean {
  try {
    assertValidMcpName(name);
  } catch {
    return false;
  }
  const expectedFilename = kind === "codex" ? `codex.${name}.pid` : `${name}.pid`;
  const resolved = path.resolve(claimed);
  if (path.basename(resolved) !== expectedFilename) return false;
  const resolvedDir = path.dirname(resolved);
  for (const dir of allowedPidfileDirs()) {
    if (path.resolve(dir) === resolvedDir) return true;
  }
  return false;
}

/**
 * Detect shell metacharacters that suggest the caller is trying to inject a
 * compound command via the `command` field of an MCP config. Used to warn /
 * refuse in add_mcp and configure_mcp.
 */
export function hasShellMetacharacters(s: string): boolean {
  return /[;&|`$<>(){}\n\r\\]/.test(s) || /\$\(/.test(s) || /&&|\|\|/.test(s);
}

/**
 * Restrict a string to characters safe to interpolate into a WMIC WQL LIKE
 * clause: alphanumerics, dot, dash, underscore, slash, backslash, dollar,
 * colon. Anything else is dropped. Used as defense in depth on top of
 * execFile + WQL quoting.
 */
export function sanitizeWqlKeyword(s: string): string {
  return s.replace(/[^a-zA-Z0-9._\-/\\$:]/g, "");
}

/** Conservative keyword for pgrep -F (fixed-string mode). */
export function sanitizePgrepKeyword(s: string): string {
  return s.replace(/[^a-zA-Z0-9._\-/\\$:]/g, "");
}

/**
 * Footgun args by interpreter basename. Each of these lets the caller smuggle
 * arbitrary code into a process whose `command` looks innocuous (`node`,
 * `python`, `bash`). The shell-metacharacter check on `command` does not catch
 * this — the payload lives in `args`. Callers can opt in via
 * allow_footgun_args=true when they legitimately need a `-c` / `-e` shell.
 */
const FOOTGUN_ARGS_BY_INTERPRETER: Record<string, ReadonlySet<string>> = {
  node: new Set(["-e", "--eval", "-p", "--print", "-r", "--require"]),
  python: new Set(["-c"]),
  python3: new Set(["-c"]),
  ruby: new Set(["-e"]),
  perl: new Set(["-e", "-E"]),
  bash: new Set(["-c"]),
  sh: new Set(["-c"]),
  zsh: new Set(["-c"]),
  ksh: new Set(["-c"]),
  pwsh: new Set(["-Command", "-c", "-EncodedCommand", "-e"]),
  powershell: new Set(["-Command", "-c", "-EncodedCommand", "-e"]),
  cmd: new Set(["/c", "/C", "/k", "/K"]),
};

function basenameOf(command: string): string {
  const last = command.split(/[\\/]/).pop() || command;
  return last.replace(/\.(exe|cmd|bat|com)$/i, "").toLowerCase();
}

export function findFootgunArg(command: string, args: readonly string[]): { interpreter: string; flag: string } | null {
  const base = basenameOf(command);
  const flags = FOOTGUN_ARGS_BY_INTERPRETER[base];
  if (!flags) return null;
  for (const a of args) {
    if (flags.has(a)) return { interpreter: base, flag: a };
    // Long-form `--require=foo` style
    if (a.startsWith("--")) {
      const eq = a.indexOf("=");
      const head = eq >= 0 ? a.slice(0, eq) : a;
      if (flags.has(head)) return { interpreter: base, flag: head };
    }
  }
  return null;
}

/**
 * Env var names that act as side-channel code-execution primitives for common
 * runtimes — loading modules, sourcing init files, injecting shared libraries.
 * A wrapped MCP whose config sets one of these is effectively "run this code
 * on every spawn." Same opt-in shape as findFootgunArg.
 */
const FOOTGUN_ENV_KEYS: ReadonlySet<string> = new Set([
  "NODE_OPTIONS",
  "NODE_PATH",
  "PYTHONSTARTUP",
  "PYTHONPATH",
  "LD_PRELOAD",
  "LD_LIBRARY_PATH",
  "LD_AUDIT",
  "DYLD_INSERT_LIBRARIES",
  "DYLD_LIBRARY_PATH",
  "BASH_ENV",
  "ENV",
  "PROMPT_COMMAND",
  "PERL5OPT",
  "PERL5LIB",
  "RUBYOPT",
  "RUBYLIB",
]);

export function findFootgunEnvKey(env: Record<string, string> | undefined): string | null {
  if (!env) return null;
  for (const key of Object.keys(env)) {
    if (FOOTGUN_ENV_KEYS.has(key)) return key;
  }
  return null;
}

/**
 * Default env passthrough for wrapped MCPs. Covers what's needed for typical
 * shells/runtimes to start (locale, temp, home, PATH) without leaking arbitrary
 * secrets from Claude Code's environment. Trailing `*` means prefix match.
 * wrap_mcp_stdio appends the MCP's own declared env keys on top.
 */
export const DEFAULT_WRAPPER_ENV_ALLOWLIST: readonly string[] = [
  "PATH", "Path", "PATHEXT",
  "HOME", "USERPROFILE",
  "SystemRoot", "WINDIR",
  "APPDATA", "LOCALAPPDATA", "ProgramData", "ProgramFiles", "ProgramFiles(x86)",
  "TEMP", "TMP", "TMPDIR",
  "LANG", "LC_*", "TZ",
  "USER", "USERNAME", "LOGNAME",
  "SHELL", "COMSPEC", "OS",
  "XDG_*",
];

