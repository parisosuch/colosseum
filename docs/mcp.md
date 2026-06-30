# Colosseum MCP Server

A stdio MCP server exposing the [REST API](api.md) as tools, so an MCP
client (Claude Desktop, Claude Code, etc.) can manage your channels and
blocks. One tool per endpoint: `list_channels`, `create_channel`,
`get_channel`, `update_channel`, `delete_channel`, `list_blocks`,
`create_block`, `get_block`, `update_block`, `delete_block`.

## Setup

Create an API token under **Settings → API tokens**, then point an MCP
client at the server with these env vars:

```json
{
  "mcpServers": {
    "colosseum": {
      "command": "bun",
      "args": ["run", "--cwd", "/path/to/colosseum", "mcp"],
      "env": {
        "COLOSSEUM_API_TOKEN": "clsm_...",
        "COLOSSEUM_BASE_URL": "https://your-host"
      }
    }
  }
}
```
