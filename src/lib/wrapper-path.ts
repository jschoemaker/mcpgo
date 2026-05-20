import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export function getStableWrapperPath(): string {
  if (process.platform === "win32") {
    const base = process.env.LOCALAPPDATA || os.homedir();
    return path.join(base, "mcpgo", "wrapper.js");
  }
  return path.join(os.homedir(), ".mcpgo", "wrapper.js");
}

const MIN_WRAPPER_BYTES = 1024;
const MAX_WRAPPER_BYTES = 1_048_576;

async function readExpectedHash(builtWrapperPath: string): Promise<string | null> {
  const sidecar = builtWrapperPath + ".sha256";
  try {
    const content = await fs.readFile(sidecar, "utf-8");
    const match = content.trim().match(/^[a-f0-9]{64}/i);
    return match ? match[0].toLowerCase() : null;
  } catch {
    return null;
  }
}

async function sha256OfFile(filePath: string): Promise<string> {
  const hash = crypto.createHash("sha256");
  hash.update(await fs.readFile(filePath));
  return hash.digest("hex");
}

/**
 * Copies the built wrapper.js to a stable user-data location and returns that
 * path. This ensures the path in ~/.claude.json survives npx cache clears and
 * version upgrades.
 *
 * Integrity checks before copying:
 *   - Source must be a regular file (not a symlink) of plausible size.
 *   - If `build/wrapper.js.sha256` exists alongside the source, its hash must
 *     match. The sidecar is produced at build time by
 *     `scripts/compute-wrapper-hash.mjs` and travels with the npm package.
 *   - The destination, if it already exists, must not be a symlink — refuse
 *     to follow one (otherwise a planted symlink turns this into an arbitrary
 *     file write primitive).
 */
export async function ensureStableWrapper(builtWrapperPath: string): Promise<string> {
  const srcStat = await fs.lstat(builtWrapperPath);
  if (srcStat.isSymbolicLink()) {
    throw new Error(`Refusing to copy wrapper: source is a symlink (${builtWrapperPath})`);
  }
  if (!srcStat.isFile()) {
    throw new Error(`Refusing to copy wrapper: source is not a regular file (${builtWrapperPath})`);
  }
  if (srcStat.size < MIN_WRAPPER_BYTES || srcStat.size > MAX_WRAPPER_BYTES) {
    throw new Error(
      `Refusing to copy wrapper: implausible size ${srcStat.size} bytes (${builtWrapperPath})`
    );
  }

  const expected = await readExpectedHash(builtWrapperPath);
  if (expected) {
    const actual = await sha256OfFile(builtWrapperPath);
    if (actual !== expected) {
      throw new Error(
        `Wrapper integrity check failed: expected ${expected}, got ${actual}. Refusing to copy.`
      );
    }
  }

  const stablePath = getStableWrapperPath();
  await fs.mkdir(path.dirname(stablePath), { recursive: true });

  try {
    const destStat = await fs.lstat(stablePath);
    if (destStat.isSymbolicLink()) {
      throw new Error(`Refusing to overwrite wrapper: destination is a symlink (${stablePath})`);
    }
  } catch (e) {
    const code = (e as NodeJS.ErrnoException)?.code;
    if (code !== "ENOENT") throw e;
  }

  await fs.copyFile(builtWrapperPath, stablePath);
  return stablePath;
}
