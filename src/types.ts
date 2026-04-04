export interface MCPConfig {
  name: string;
  type: "stdio" | "http" | "sse";
  command?: string;
  args?: string[];
  url?: string;
  headers?: Record<string, string>;
  env?: Record<string, string>;
  scope: "user" | "project" | "local";
}

export interface MCPStatus {
  name: string;
  status: "connected" | "disconnected" | "error" | "needs_auth";
  transport: string;
  tools?: string[];
  lastCheck?: string;
}

export interface ToolResponse {
  success: boolean;
  message: string;
  data?: unknown;
  error?: string;
}
