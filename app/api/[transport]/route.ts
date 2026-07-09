// MCP server exposing channels and blocks as tools (docs/mcp.md), so an MCP
// client (Claude Desktop, Claude Code, etc.) can manage them. Runs in-process
// as a Next.js route handler — same deploy as the rest of the app, no
// separate process — and calls the same data-access layer the REST API
// (app/api/v1, docs/api.md) uses, under the same token-based auth.
import { NextResponse } from "next/server";
import { createMcpHandler, withMcpAuth } from "mcp-handler";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { z } from "zod";

import {
  ApiAuth,
  authorizeChannelRead,
  authorizeChannelWrite,
  resolveApiToken,
} from "@/lib/colosseum/api-auth";
import {
  Channel,
  createChannel,
  deleteChannel,
  getChannel,
  getUserChannels,
  updateChannel,
} from "@/lib/colosseum/channel";
import {
  Column,
  deleteColumn,
  getChannelColumns,
  getColumn,
  updateColumn,
  uploadImageColumn,
  uploadTextColumn,
  uploadURLColumn,
} from "@/lib/colosseum/column";
import { logError } from "@/lib/log";

export const runtime = "nodejs";

// A denial from authorizeChannelRead/Write is a NextResponse (the shape the
// REST API returns directly). Tool handlers can't return a NextResponse, so
// turn it into the same message as a thrown error instead — asTool below
// converts that into an MCP tool error.
async function denialToError(denial: NextResponse): Promise<Error> {
  const body = (await denial.json()) as { error?: string };
  return new Error(body.error ?? "Request denied.");
}

async function requireChannel(
  userId: string,
  channelId: number,
  access: "read" | "write",
): Promise<Channel> {
  const channel = await getChannel(channelId);
  const denial =
    access === "read"
      ? authorizeChannelRead(channel, userId)
      : authorizeChannelWrite(channel, userId);
  if (denial) throw await denialToError(denial);
  return channel!;
}

async function requireBlock(
  userId: string,
  blockId: number,
  access: "read" | "write",
): Promise<Column> {
  const block = await getColumn(blockId);
  if (!block) throw new Error("Not found.");
  await requireChannel(userId, block.channel_id, access);
  return block;
}

// Wraps a tool handler so thrown errors (denials, validation, DB failures)
// become MCP tool errors instead of crashing the server.
function asTool<T>(fn: (args: T, auth: ApiAuth) => Promise<unknown>) {
  return async (args: T, extra: { authInfo?: AuthInfo }) => {
    const auth = extra.authInfo?.extra?.auth as ApiAuth | undefined;
    if (!auth) {
      return {
        content: [{ type: "text" as const, text: "Not authenticated." }],
        isError: true,
      };
    }
    try {
      const result = await fn(args, auth);
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

// Fields a block PATCH may set, by block type. title/description apply to any.
// Mirrors EDITABLE_BY_TYPE in app/api/v1/blocks/[id]/route.ts.
const EDITABLE_BY_TYPE: Record<string, string[]> = {
  text: ["title", "description", "text"],
  url: ["title", "description", "url"],
  image: ["title", "description", "image"],
};

const handler = createMcpHandler(
  (server) => {
    server.registerTool(
      "list_channels",
      { description: "List your Colosseum channels.", inputSchema: {} },
      asTool(async (_args: Record<string, never>, { userId }) => ({
        channels: await getUserChannels(userId),
      })),
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
      asTool(
        async (args: { title: string; description?: string; private?: boolean }, { userId }) => {
          const title = args.title.trim();
          if (!title) throw new Error("`title` is required.");
          return {
            channel: await createChannel({
              title,
              description: args.description,
              private: args.private ?? false,
              owner_id: userId,
            }),
          };
        },
      ),
    );

    server.registerTool(
      "get_channel",
      {
        description: "Fetch a channel by id (public or owned).",
        inputSchema: { id: z.number().int() },
      },
      asTool(async ({ id }: { id: number }, { userId }) => ({
        channel: await requireChannel(userId, id, "read"),
      })),
    );

    server.registerTool(
      "update_channel",
      {
        description: "Update a channel you own. Omitted fields are unchanged.",
        inputSchema: {
          id: z.number().int(),
          title: z.string().optional(),
          description: z.string().optional(),
          private: z.boolean().optional(),
        },
      },
      asTool(
        async (
          args: { id: number; title?: string; description?: string; private?: boolean },
          { userId },
        ) => {
          const channel = await requireChannel(userId, args.id, "write");
          const title = args.title !== undefined ? args.title.trim() : channel.title;
          if (!title) throw new Error("`title` cannot be empty.");
          return {
            channel: await updateChannel(args.id, {
              title,
              description: args.description ?? channel.description,
              private: args.private ?? channel.private,
            }),
          };
        },
      ),
    );

    server.registerTool(
      "delete_channel",
      {
        description: "Delete a channel you own (its blocks cascade).",
        inputSchema: { id: z.number().int() },
      },
      asTool(async ({ id }: { id: number }, { userId }) => {
        await requireChannel(userId, id, "write");
        await deleteChannel(id);
        return { success: true };
      }),
    );

    server.registerTool(
      "list_blocks",
      {
        description: "List a channel's blocks (public or owned).",
        inputSchema: { channelId: z.number().int(), limit: z.number().int().positive().optional() },
      },
      asTool(async ({ channelId, limit }: { channelId: number; limit?: number }, { userId }) => {
        await requireChannel(userId, channelId, "read");
        return { blocks: await getChannelColumns(channelId, { limit }, userId) };
      }),
    );

    server.registerTool(
      "create_block",
      {
        description:
          "Add a block to a channel you own. Exactly one of text/url/image must match `type`. " +
          "URL blocks added this way are not screenshotted (that flow is web-only).",
        inputSchema: {
          channelId: z.number().int(),
          type: z.enum(["text", "url", "image"]),
          text: z.string().optional(),
          url: z.string().optional(),
          image: z.string().optional(),
        },
      },
      asTool(
        async (
          args: {
            channelId: number;
            type: "text" | "url" | "image";
            text?: string;
            url?: string;
            image?: string;
          },
          { userId },
        ) => {
          await requireChannel(userId, args.channelId, "write");
          const base = { created_by: userId, channel_id: args.channelId };

          if (args.type === "text") {
            if (!args.text?.trim()) throw new Error("`text` is required for a text block.");
            return { block: await uploadTextColumn({ ...base, text: args.text }) };
          }
          if (args.type === "url") {
            if (!args.url?.trim()) throw new Error("`url` is required for a url block.");
            return { block: await uploadURLColumn({ ...base, text: args.url.trim() }) };
          }
          if (!args.image?.trim())
            throw new Error("`image` (a public URL) is required for an image block.");
          return {
            block: await uploadImageColumn({ ...base, image: args.image.trim() }),
          };
        },
      ),
    );

    server.registerTool(
      "get_block",
      {
        description: "Fetch a block (visible if its channel is public or owned).",
        inputSchema: { id: z.number().int() },
      },
      asTool(async ({ id }: { id: number }, { userId }) => ({
        block: await requireBlock(userId, id, "read"),
      })),
    );

    server.registerTool(
      "update_block",
      {
        description: "Update a block in a channel you own. Omitted fields are unchanged.",
        inputSchema: {
          id: z.number().int(),
          title: z.string().optional(),
          description: z.string().optional(),
          text: z.string().optional(),
          url: z.string().optional(),
          image: z.string().optional(),
        },
      },
      asTool(
        async (
          args: {
            id: number;
            title?: string;
            description?: string;
            text?: string;
            url?: string;
            image?: string;
          },
          { userId },
        ) => {
          const block = await requireBlock(userId, args.id, "write");
          const allowed = EDITABLE_BY_TYPE[block.type] ?? ["title", "description"];
          const updates: Record<string, string> = {};
          for (const key of allowed) {
            const value = (args as Record<string, unknown>)[key];
            if (typeof value === "string") updates[key] = value;
          }
          if (Object.keys(updates).length === 0) {
            throw new Error(`No editable fields provided. Allowed: ${allowed.join(", ")}.`);
          }

          return { block: await updateColumn(args.id, updates) };
        },
      ),
    );

    server.registerTool(
      "delete_block",
      {
        description: "Delete a block in a channel you own.",
        inputSchema: { id: z.number().int() },
      },
      asTool(async ({ id }: { id: number }, { userId }) => {
        await requireBlock(userId, id, "write");
        await deleteColumn(id);
        return { success: true };
      }),
    );
  },
  {},
  {
    basePath: "/api",
    maxDuration: 60,
    disableSse: true,
  },
);

const verifyToken = async (_req: Request, bearerToken?: string): Promise<AuthInfo | undefined> => {
  if (!bearerToken) return undefined;
  try {
    const auth = await resolveApiToken(bearerToken);
    if (!auth) return undefined;
    return { token: bearerToken, clientId: auth.userId, scopes: [], extra: { auth } };
  } catch (e) {
    logError("mcp.auth", "token resolution failed (DB error)", e);
    return undefined;
  }
};

const authHandler = withMcpAuth(handler, verifyToken, { required: true });

export { authHandler as GET, authHandler as POST };
