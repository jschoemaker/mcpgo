# mcpgo

Manage your Claude Code MCPs by talking to Claude — list, restart, wrap, and more.

Works everywhere Claude Code works, including **Remote Control** where `/mcp` isn't available.

## Installation

```bash
claude mcp add mcpgo -- npx -y @exfil/mcpgo
```

No cloning, no building.

**Requirements:** Node.js ≥ 18

## Remote Control

Claude Code's Remote Control mode has no access to `/mcp`. That means you can't list, restart, or manage MCP servers remotely — unless you have mcpgo.

Because mcpgo is itself an MCP server, it's available everywhere Claude Code is:

```
"list my mcps"
"restart github"
"check postgres health"
```

No `/mcp` UI needed.

## What it does

### Reliable restarts

Claude Code connects to stdio MCP servers via pipes it creates at launch. If a server crashes or you want to restart it, Claude Code marks it as failed with no auto-recovery.

mcpgo solves this with a **wrapper**: a long-lived process that sits between Claude Code and your MCP. Claude Code talks to the wrapper (which stays alive), and the wrapper spawns the real server as a child — auto-respawning it whenever it's killed.

Wrapping is **optional** — you can use mcpgo just for listing, adding, or removing MCPs without wrapping anything. Wrapping is only needed if you want reliable restarts without touching `/mcp`.

**One-time setup per MCP:**
1. `wrap_mcp_stdio` — wraps the target MCP in config
2. Restart Claude Code (or disconnect + reconnect via `/mcp`)
3. Done — use `restart_mcp_process` anytime

**After setup:**
```
"restart github"     → instant, wrapper auto-respawns the child, Claude Code stays connected
"restart postgres"        → same
```

If you ever want to undo wrapping, use `unwrap_mcp_stdio` to restore the original config.

## Tools

### Process management

#### `wrap_mcp_stdio`
Wrap a Claude Code stdio MCP for reliable restarts.
```
"wrap github"
"wrap postgres"
```

#### `unwrap_mcp_stdio`
Restore a wrapped MCP to its original config.
```
"unwrap github"
"unwrap postgres"
```

#### `restart_mcp_process`
Restart a wrapped MCP's child process — wrapper auto-respawns it, Claude Code stays connected.
```
"restart github"
"restart postgres"
```

#### `check_mcp_health`
Check if an MCP is configured, wrapped, and its process is running.
```
"check github health"
"is postgres running?"
```

### Codex CLI support

#### `wrap_codex_mcp_stdio`
Wrap a Codex CLI MCP from `~/.codex/config.toml`.
```
"wrap my codex mcp called postgres"
```

#### `restart_codex_mcp_process`
Restart a wrapped Codex CLI MCP.
```
"restart the codex postgres"
```

### Config management

#### `list_all_mcps`
List all configured MCP servers.
```
"list my mcps"
"what mcps do I have?"
```

#### `add_mcp`
Add a new MCP server to `~/.claude.json`.
```
"add an mcp called my-tool that runs python server.py"
```

#### `remove_mcp`
Remove an MCP server.
```
"remove the my-tool mcp"
```

#### `configure_mcp`
Update an existing MCP server's config fields.
```
"change github's command to python3"
```

#### `get_mcp_details`
Get full config details for a specific MCP.
```
"show me the github config"
"get details for postgres"
```

## How wrapping works

When you call `wrap_mcp_stdio "github"`, the config entry changes from:

```json
{ "command": "python", "args": ["server.py"] }
```

to:

```json
{
  "command": "node",
  "args": ["/path/to/wrapper.js", "--name", "github", "--pidfile", "...", "--", "python", "server.py"]
}
```

The wrapper:
- Spawns the original command as a child
- Writes the child's PID to a pidfile
- Auto-respawns the child on exit (with backoff)
- Exits cleanly on SIGTERM, SIGINT, or stdin EOF

`restart_mcp_process` reads the pidfile and kills the child. The wrapper respawns it — Claude Code never sees a disconnect.

`unwrap_mcp_stdio` reverses this — it restores the original command from the args after `--` and removes the pidfile.

## Stable wrapper location

When you wrap an MCP, mcpgo copies `wrapper.js` to a stable user-data location and writes that path into `~/.claude.json`. This means the config survives npx cache clears and mcpgo version upgrades — the wrapper won't disappear from under you.

- **Windows:** `%LOCALAPPDATA%\mcpgo\wrapper.js`
- **Linux/macOS:** `~/.mcpgo/wrapper.js`

Re-running `wrap_mcp_stdio` on an already-wrapped MCP refreshes the wrapper copy in place.

## Pidfile locations

- **Windows:** `%LOCALAPPDATA%\mcpgo\pids\<name>.pid`
- **Linux/macOS:** `$TMPDIR/mcpgo/pids/<name>.pid`

## Notes

- Wrapping requires a Claude Code restart (or manual `/mcp` disconnect + reconnect) to take effect — Claude Code caches config in memory
- `restart_mcp_process` works best on wrapped MCPs; for unwrapped ones it kills the process but you'll need to reconnect manually via `/mcp`
- Mid-request crashes may cause a brief protocol desync; Claude Code recovers on the next tool call
