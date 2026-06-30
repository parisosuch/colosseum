/**
 * MCP server exposing Colosseum's REST API (docs/api.md) as tools, so an MCP
 * client (Claude Desktop, Claude Code, etc.) can manage channels and blocks.
 *
 * Config (env vars):
 *   COLOSSEUM_API_TOKEN  - bearer token from Settings -> API tokens (required)
 *   COLOSSEUM_BASE_URL   - e.g. https://your-host (required)
 *
 *   bun run mcp
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const TOKEN = process.env.COLOSSEUM_API_TOKEN;
const BASE_URL = process.env.COLOSSEUM_BASE_URL;
if (!TOKEN || !BASE_URL) {
  console.error("COLOSSEUM_API_TOKEN and COLOSSEUM_BASE_URL must be set.");
  process.exit(1);
}

async function callApi(path: string, init?: RequestInit) {
  const res = await fetch(`${BASE_URL}/api/v1${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body.error ?? `Request failed with status ${res.status}`);
  }
  return body;
}

// Wraps a tool handler so thrown API errors become MCP tool errors instead of
// crashing the server.
function asTool<T>(fn: (args: T) => Promise<unknown>) {
  return async (args: T) => {
    try {
      const result = await fn(args);
      return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
    } catch (err) {
      return {
        content: [
          { type: "text" as const, text: err instanceof Error ? err.message : String(err) },
        ],
        isError: true,
      };
    }
  };
}

const server = new McpServer({ name: "colosseum", version: "1.0.0" });

server.registerTool(
  "list_channels",
  { description: "List your Colosseum channels." },
  asTool(async () => callApi("/channels")),
);

server.registerTool(
  "create_channel",
  {
    description: "Create a Colosseum channel.",
    inputSchema: {
      title: z.string(),
      description: z.string().optional(),
      private: z.boolean().optional(),
    },
  },
  asTool(async (args) => callApi("/channels", { method: "POST", body: JSON.stringify(args) })),
);

server.registerTool(
  "get_channel",
  {
    description: "Fetch a channel by id (public or owned).",
    inputSchema: { id: z.string() },
  },
  asTool(async ({ id }) => callApi(`/channels/${id}`)),
);

server.registerTool(
  "update_channel",
  {
    description: "Update a channel you own. Omitted fields are unchanged.",
    inputSchema: {
      id: z.string(),
      title: z.string().optional(),
      description: z.string().optional(),
      private: z.boolean().optional(),
    },
  },
  asTool(async ({ id, ...patch }) =>
    callApi(`/channels/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  ),
);

server.registerTool(
  "delete_channel",
  {
    description: "Delete a channel you own (its blocks cascade).",
    inputSchema: { id: z.string() },
  },
  asTool(async ({ id }) => callApi(`/channels/${id}`, { method: "DELETE" })),
);

server.registerTool(
  "list_blocks",
  {
    description: "List a channel's blocks (public or owned).",
    inputSchema: { channelId: z.string(), limit: z.number().optional() },
  },
  asTool(async ({ channelId, limit }) =>
    callApi(`/channels/${channelId}/blocks${limit ? `?limit=${limit}` : ""}`),
  ),
);

server.registerTool(
  "create_block",
  {
    description:
      "Add a block to a channel you own. Exactly one of text/url/image must match `type`.",
    inputSchema: {
      channelId: z.string(),
      type: z.enum(["text", "url", "image"]),
      text: z.string().optional(),
      url: z.string().optional(),
      image: z.string().optional(),
    },
  },
  asTool(async ({ channelId, ...body }) =>
    callApi(`/channels/${channelId}/blocks`, { method: "POST", body: JSON.stringify(body) }),
  ),
);

server.registerTool(
  "get_block",
  {
    description: "Fetch a block (visible if its channel is public or owned).",
    inputSchema: { id: z.string() },
  },
  asTool(async ({ id }) => callApi(`/blocks/${id}`)),
);

server.registerTool(
  "update_block",
  {
    description: "Update a block in a channel you own. Omitted fields are unchanged.",
    inputSchema: {
      id: z.string(),
      title: z.string().optional(),
      description: z.string().optional(),
      text: z.string().optional(),
      url: z.string().optional(),
      image: z.string().optional(),
    },
  },
  asTool(async ({ id, ...patch }) =>
    callApi(`/blocks/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  ),
);

server.registerTool(
  "delete_block",
  {
    description: "Delete a block in a channel you own.",
    inputSchema: { id: z.string() },
  },
  asTool(async ({ id }) => callApi(`/blocks/${id}`, { method: "DELETE" })),
);

await server.connect(new StdioServerTransport());
