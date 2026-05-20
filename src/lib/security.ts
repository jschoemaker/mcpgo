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
