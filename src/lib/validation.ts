export function validateMcpName(name: string): boolean {
  return /^[a-zA-Z0-9_-]+$/.test(name);
}

export function validateMcpConfig(
  config: Partial<{ type: string; command: string; url: string }>
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!config.type) errors.push("type is required (stdio|http|sse)");
  if (config.type === "stdio" && !config.command) errors.push("command is required for stdio type");
  if ((config.type === "http" || config.type === "sse") && !config.url) {
    errors.push("url is required for http/sse type");
  }
  return { valid: errors.length === 0, errors };
}
