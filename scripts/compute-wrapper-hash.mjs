#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

const buildDir = path.resolve("build");
const wrapperPath = path.join(buildDir, "wrapper.js");
const sidecarPath = wrapperPath + ".sha256";

try {
  const content = await fs.readFile(wrapperPath);
  const hash = crypto.createHash("sha256").update(content).digest("hex");
  await fs.writeFile(sidecarPath, hash + "\n", "utf-8");
  console.log(`wrote ${path.relative(process.cwd(), sidecarPath)}: ${hash}`);
} catch (err) {
  console.error("failed to compute wrapper hash:", err);
  process.exit(1);
}
