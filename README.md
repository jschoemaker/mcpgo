# mcpgo

An MCP server that manages your other MCP servers — wrap, restart, add, remove, and health check, all from within Claude Code.

## Installation

Add to Claude Code:

```bash
claude mcp add mcpgo -- npx -y mcpgo
```

That's it. No cloning, no building.

## What it does

### Reliable restarts (the main feature)

Claude Code connects to stdio MCP servers via pipes it creates at launch. If a server crashes or you want to restart it, Claude Code marks it as failed with no auto-recovery.

`mcp-manager` solves this with a **wrapper**: a long-lived process that sits between Claude Code and your MCP. Claude Code talks to the wrapper (which stays alive), and the wrapper spawns the real server as a child — auto-respawning it whenever it's killed.

**One-time setup per MCP:**
1. `wrap_mcp_stdio` — wraps the target MCP in config
2. Restart Claude Code (or disconnect + reconnect via `/mcp`)
3. Done — use `restart_mcp_process` anytime

**After setup:**
```
"restart bridge"     → instant, no /mcp needed, wrapper auto-respawns the child
"restart driftcli"   → same
```

## Tools

### Process management
| Tool | Description |
|------|-------------|
| `wrap_mcp_stdio` | Wrap a Claude Code stdio MCP for reliable restarts |
| `unwrap_mcp_stdio` | Restore an MCP to its original unwrapped config |
| `restart_mcp_process` | Restart a wrapped MCP's child process (wrapper auto-respawns it) |
| `check_mcp_health` | Check if an MCP is configured, wrapped, and running |

### Codex CLI support
| Tool | Description |
|------|-------------|
| `wrap_codex_mcp_stdio` | Wrap a Codex CLI MCP (`~/.codex/config.toml`) |
| `restart_codex_mcp_process` | Restart a wrapped Codex MCP |

### Config management
| Tool | Description |
|------|-------------|
| `list_all_mcps` | List all configured MCP servers |
| `add_mcp` | Add a new MCP server |
| `remove_mcp` | Remove an MCP server |
| `configure_mcp` | Update an existing MCP server's config |
| `get_mcp_details` | Get full config details for an MCP |

## How wrapping works

When you call `wrap_mcp_stdio "bridge"`, the config entry changes from:

```json
{ "command": "python", "args": ["server.py"] }
```

to:

```json
{
  "command": "node",
  "args": ["/path/to/wrapper.js", "--name", "bridge", "--pidfile", "...", "--", "python", "server.py"]
}
```

The wrapper:
- Spawns the original command as a child
- Writes the child's PID to a pidfile
- Auto-respawns the child on exit (with backoff)
- Exits cleanly on SIGTERM, SIGINT, or stdin EOF

`restart_mcp_process` reads the pidfile and kills the child. The wrapper respawns it — Claude Code never sees a disconnect.

## Pidfile locations

- **Windows:** `%LOCALAPPDATA%\mcpmanager\pids\<name>.pid`
- **Linux/macOS:** `$TMPDIR/mcpmanager/pids/<name>.pid`

## Notes

- Wrapping requires a Claude Code restart (or manual disconnect + reconnect) to take effect — Claude Code caches config in memory
- `restart_mcp_process` works best on wrapped MCPs; for unwrapped ones it kills the process but you'll need to reconnect manually via `/mcp`
- Mid-request crashes may cause a protocol desync; Claude Code recovers on the next tool call
