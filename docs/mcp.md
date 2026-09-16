# Colosseum MCP Server

Colosseum exposes an [MCP](https://modelcontextprotocol.io) server so an MCP
client (Claude Desktop, Claude Code, Cursor, etc.) can manage your channels
and blocks — "add this link to my reading list," "summarize my design-inspo
channel," and so on.

It's a **remote** MCP server: it runs in-process as part of the Next.js app
(`app/api/[transport]/route.ts`), using the
[Streamable HTTP](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports#streamable-http)
transport. There's nothing extra to deploy — if you can reach your Colosseum
instance, you can reach its MCP server. Self-hosting via the included
[`Dockerfile`](../Dockerfile) gets you MCP for free, with no extra container
or process.

## Connecting a client

1. Create a token under **Settings → API tokens**. The plaintext is shown
   once — store it somewhere safe.
2. Point your MCP client at `https://your-host/api/mcp` with that token as a
   bearer token. The exact config shape depends on the client:

**Claude Code** (`claude mcp add` or `.mcp.json`):

```json
{
  "mcpServers": {
    "colosseum": {
      "type": "http",
      "url": "https://your-host/api/mcp",
      "headers": {
        "Authorization": "Bearer clsm_..."
      }
    }
  }
}
```

**Claude Desktop** (`claude_desktop_config.json`) — Desktop's built-in
connector UI ("Settings → Connectors → Add custom connector") will prompt
for the URL and let you add the header; the underlying config looks the
same as above, under `mcpServers`.

For local development, use `http://localhost:3000/api/mcp`.

## Authentication

Same token, same rules as the [REST API](api.md): `Authorization: Bearer
clsm_...`. A token grants the same access its owner has — it can read public
channels and anything it owns, and write only what it owns. "Owns" includes the
groups you belong to, up to the role you hold in each. An invalid or missing
token gets a `401` before any tool runs.

## Tools

One tool per REST endpoint, plus `move_block`, which has no REST equivalent.
Reads are visible if a channel is public or you own it; writes require
ownership. A group's channels count as yours on both counts.

| Tool             | Equivalent                               | Notes                                                                |
| ---------------- | ---------------------------------------- | -------------------------------------------------------------------- |
| `whoami`         | `GET /api/v1/me`                         | Your `handle`, and the block allowance `create_block` refuses on.    |
| `list_channels`  | `GET /api/v1/channels`                   | Yours and your groups', each with the `handle` it lives under.       |
| `list_groups`    | `GET /api/v1/groups`                     | The groups you're in, with your `role` in each.                      |
| `leave_channel`  | `DELETE /api/v1/channels/:id/members/me` | `channelId`. Not one you manage.                                     |
| `create_channel` | `POST /api/v1/channels`                  | `title`, optional `description`, `private`, `owner`.                 |
| `get_channel`    | `GET /api/v1/channels/:id`               | `id`.                                                                |
| `update_channel` | `PATCH /api/v1/channels/:id`             | `id` + any of `title`/`description`/`private`.                       |
| `delete_channel` | `DELETE /api/v1/channels/:id`            | `id`. Cascades to the channel's blocks.                              |
| `list_blocks`    | `GET /api/v1/channels/:id/blocks`        | `channelId`, optional `limit`.                                       |
| `create_block`   | `POST /api/v1/channels/:id/blocks`       | `channelId`, `type` + the matching field, optional `tags`, `detect`. |
| `get_block`      | `GET /api/v1/blocks/:id`                 | `id`.                                                                |
| `update_block`   | `PATCH /api/v1/blocks/:id`               | `id` + editable fields for that block's type, and `tags`.            |
| `delete_block`   | `DELETE /api/v1/blocks/:id`              | `id`.                                                                |
| `move_block`     | —                                        | `id`, `channelId`. You must own both channels.                       |

`create_block`/`update_block` field rules match the REST API: exactly one of
`text`/`url`/`image` for creation (matching `type`), and only that type's
field (plus `title`/`description`) on update. A url block's preview screenshot
captures in the background, exactly as it does over REST: the tool returns
immediately with `preview: null`, and `get_block` reports the same three states
the REST API documents — `null` while capturing, `{ "failed": true }` after a
permanent failure, `{ "image_url", "title" }` once it lands.

A url passed to `create_block` is ingested as what it points at — tweet,
YouTube video or channel, Spotify item, GitHub repo or account, Instagram post,
direct image — each becoming that kind of block with its details fetched and
stored, exactly as a link pasted into the web app does. Anything else stays a
plain link with a screenshot, and a failed lookup falls back to one too. The
returned block's `type` is therefore often not `url`; `detect: false` forces a
plain link.

`tags` are accepted on both and replace the whole list, so pass the ones you
want to keep — `[]` on `update_block` clears them. They are alphanumeric with
dashes: spaces become dashes, anything else is dropped, and duplicates are
removed. The board filters on an exact match, so a tag written in any other
shape would match nothing, which is why the rule is shared with the editor
(`lib/tags.ts`) rather than restated here.

`move_block` only rewrites the block's `channel_id`, so the block keeps its id,
`created_at`, tags, content, and any cached screenshot. `update_block` can't do
this (`channel_id` isn't editable), and create-then-delete drops the timestamp
and the screenshot.

`copy_block` is the other half of that pair: it leaves the original in place and
makes a new block, with its own id and its own media reference, so the two can
be deleted independently. It also asks less — read on the source rather than
ownership — so a block from anyone's channel you can see may be copied into
yours.

`delete_group` takes a `confirm` flag the other tools don't. Deleting a group
deletes every channel it owns and every block in them, and nothing else in this
API cascades that far — the flag is there so a model has to mean it.

A failed call (bad input, not found, not yours) comes back as an MCP tool
error (`isError: true`) with a human-readable message — the agent sees it
and can retry or explain, rather than the server crashing.

## Design

The MCP route calls the same data-access layer (`lib/colosseum/*`) and
authorization helpers (`lib/colosseum/api-auth.ts`) as the REST API, so
there's one source of truth for "what can this token do" — no separate
auth path to keep in sync. It uses [`mcp-handler`](https://github.com/vercel/mcp-handler)
to bridge the MCP SDK's Streamable HTTP transport into a Next.js route
handler.

This intentionally differs from an earlier stdio-based design (spawn a local
script per client, talking to the REST API over HTTP): folding MCP into the
app itself means self-hosters don't run or deploy anything beyond the app
they already have, and any client can connect over the network instead of
needing a local checkout of this repo.
