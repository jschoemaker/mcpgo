import { execFile } from "child_process";
import { promisify } from "util";
import { sanitizePgrepKeyword, sanitizeWqlKeyword } from "./security.js";

const execFileAsync = promisify(execFile);

/**
 * Escape a value for inclusion inside a single-quoted WMIC WQL string literal.
 * WQL doubles single quotes; we also strip percents/underscores because the
 * caller uses LIKE with literal wildcards we control.
 */
function escapeWqlLiteral(s: string): string {
  return s.replace(/'/g, "''").replace(/[%_]/g, "");
}

export async function findAllProcessesByCommand(keyword: string, rootCommand?: string): Promise<number[]> {
  const safeKeyword = sanitizeWqlKeyword(keyword);
  if (!safeKeyword) return [];
  const safeRoot = rootCommand ? sanitizeWqlKeyword(rootCommand) : undefined;

  try {
    if (process.platform === "win32") {
      const claudePid = process.ppid;

      const runWmic = async (where: string): Promise<number[]> => {
        try {
          const { stdout } = await execFileAsync(
            "wmic",
            ["process", "where", where, "get", "ProcessId"],
            { timeout: 10000, windowsHide: true }
          );
          return stdout
            .split("\n")
            .map((l) => l.trim())
            .filter((l) => /^\d+$/.test(l))
            .map(Number);
        } catch {
          return [];
        }
      };

      const kw = escapeWqlLiteral(safeKeyword);
      const root = safeRoot ? escapeWqlLiteral(safeRoot) : undefined;

      // Filter cascade: tightest → broadest. Parent-PID + root-command + keyword
      // wins; we widen only on empty results to keep scope minimal.
      if (root) {
        const a = await runWmic(
          `name='${root}' and parentprocessid=${claudePid} and commandline like '%${kw}%'`
        );
        if (a.length > 0) return a;
      } else {
        const a = await runWmic(
          `parentprocessid=${claudePid} and commandline like '%${kw}%'`
        );
        if (a.length > 0) return a;
      }

      if (root) {
        const b = await runWmic(`name='${root}' and commandline like '%${kw}%'`);
        if (b.length > 0) return b;
      }

      const c = await runWmic(
        `parentprocessid=${claudePid} and commandline like '%${kw}%'`
      );
      if (c.length > 0) return c;

      return await runWmic(`commandline like '%${kw}%'`);
    } else {
      const safePgrep = sanitizePgrepKeyword(safeKeyword);
      if (!safePgrep) return [];
      try {
        const { stdout } = await execFileAsync("pgrep", ["-f", safePgrep], {
          timeout: 10000,
        });
        return stdout
          .trim()
          .split("\n")
          .map(Number)
          .filter((n) => !Number.isNaN(n));
      } catch {
        return [];
      }
    }
  } catch {
    return [];
  }
}

export async function killPid(pid: number): Promise<boolean> {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    if (process.platform === "win32") {
      try {
        await execFileAsync("taskkill", ["/PID", String(pid)], { timeout: 5000, windowsHide: true });
      } catch {
        await execFileAsync("taskkill", ["/F", "/PID", String(pid)], { timeout: 5000, windowsHide: true });
      }
    } else {
      process.kill(pid, "SIGTERM");
    }
    return true;
  } catch {
    return false;
  }
}
