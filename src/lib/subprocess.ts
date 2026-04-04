import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

export async function runClaudeCommand(args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  try {
    const cmd = process.platform === "win32"
      ? `cmd /c claude ${args.join(" ")}`
      : `claude ${args.join(" ")}`;
    const { stdout, stderr } = await execAsync(cmd, { timeout: 30000 });
    return { stdout, stderr, exitCode: 0 };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; code?: number };
    return { stdout: e.stdout || "", stderr: e.stderr || String(err), exitCode: e.code || 1 };
  }
}

export async function killProcessByName(name: string): Promise<boolean> {
  try {
    if (process.platform === "win32") {
      await execAsync(`taskkill /F /IM ${name}.exe`, { timeout: 10000 });
    } else {
      await execAsync(`pkill -f ${name}`, { timeout: 10000 });
    }
    return true;
  } catch {
    return false;
  }
}

export async function findProcessByCommand(keyword: string): Promise<number | null> {
  const pids = await findAllProcessesByCommand(keyword);
  return pids.length > 0 ? pids[0] : null;
}

export async function findAllProcessesByCommand(keyword: string, rootCommand?: string): Promise<number[]> {
  try {
    if (process.platform === "win32") {
      const claudePid = process.ppid;
      const filter = rootCommand
        ? `name='${rootCommand}' and parentprocessid=${claudePid} and commandline like '%${keyword}%'`
        : `parentprocessid=${claudePid} and commandline like '%${keyword}%'`;
      const { stdout } = await execAsync(
        `wmic process where "${filter}" get ProcessId`,
        { timeout: 10000 }
      );
      const pids = stdout.split("\n").map((l: string) => l.trim()).filter((l: string) => /^\d+$/.test(l)).map(Number);
      if (pids.length > 0) return pids;
      // Fallback 1: remove parent filter (process may have been reparented)
      if (rootCommand) {
        const fb1Filter = `name='${rootCommand}' and commandline like '%${keyword}%'`;
        const { stdout: fb1 } = await execAsync(`wmic process where "${fb1Filter}" get ProcessId`, { timeout: 10000 });
        const fb1Pids = fb1.split("\n").map((l: string) => l.trim()).filter((l: string) => /^\d+$/.test(l)).map(Number);
        if (fb1Pids.length > 0) return fb1Pids;
      }
      // Fallback 2: no rootCommand or parent filter — search only by keyword under parent
      const fb2Filter = `parentprocessid=${claudePid} and commandline like '%${keyword}%'`;
      const { stdout: fb2 } = await execAsync(`wmic process where "${fb2Filter}" get ProcessId`, { timeout: 10000 });
      const fb2Pids = fb2.split("\n").map((l: string) => l.trim()).filter((l: string) => /^\d+$/.test(l)).map(Number);
      if (fb2Pids.length > 0) return fb2Pids;
      // Fallback 3: broadest — just keyword anywhere
      const fb3Filter = `commandline like '%${keyword}%'`;
      const { stdout: fb3 } = await execAsync(`wmic process where "${fb3Filter}" get ProcessId`, { timeout: 10000 });
      return fb3.split("\n").map((l: string) => l.trim()).filter((l: string) => /^\d+$/.test(l)).map(Number);
    } else {
      const { stdout } = await execAsync(`pgrep -f ${keyword}`, { timeout: 10000 });
      return stdout.trim().split("\n").map(Number).filter(n => !isNaN(n));
    }
  } catch {
    return [];
  }
}

export async function killPid(pid: number): Promise<boolean> {
  try {
    if (process.platform === "win32") {
      // Try graceful first (WM_CLOSE), fall back to force if needed
      try {
        await execAsync(`taskkill /PID ${pid}`, { timeout: 5000 });
      } catch {
        await execAsync(`taskkill /F /PID ${pid}`, { timeout: 5000 });
      }
    } else {
      process.kill(pid, "SIGTERM");
    }
    return true;
  } catch {
    return false;
  }
}
