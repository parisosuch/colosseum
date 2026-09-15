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
  attachPreview,
  attachPreviews,
  authorizeBlockWrite,
  authorizeChannelContribute,
  authorizeChannelManage,
  authorizeChannelRead,
  moveBlock,
  parseAccess,
  resolveApiToken,
} from "@/lib/colosseum/api-auth";
import {
  Channel,
  createChannel,
  deleteChannel,
  getChannel,
  getViewerChannels,
  updateChannel,
  viewerScope,
} from "@/lib/colosseum/channel";
import { resolveCreateOwner } from "@/lib/colosseum/owner";
import { getColumnQuota } from "@/lib/colosseum/admin";
import { getUserProfile } from "@/lib/colosseum/user";
import { listUserGroups } from "@/lib/colosseum/group";
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
import { putImageBlobFromUrl } from "@/lib/colosseum/blob";
import { triggerScreenshotCapture } from "@/lib/colosseum/screenshot";
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
  access: "read" | "contribute" | "manage",
): Promise<Channel> {
  const channel = await getChannel(channelId);
  const denial =
    access === "read"
      ? await authorizeChannelRead(channel, userId)
      : access === "contribute"
        ? await authorizeChannelContribute(channel, userId)
        : await authorizeChannelManage(channel, userId);
  if (denial) throw await denialToError(denial);
  return channel!;
}

async function requireBlock(
  userId: string,
  blockId: number,
  access: "read" | "write",
): Promise<Column> {
  // The block is used for authorization and then returned as an API payload,
  // neither of which renders the markdown.
  const block = await getColumn(blockId, { html: false });
  if (!block) throw new Error("Not found.");
  const channel = await getChannel(block.channel_id);
  const denial =
    access === "read"
      ? await authorizeChannelRead(channel, userId)
      : await authorizeBlockWrite(channel, block, userId);
  if (denial) throw await denialToError(denial);
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
      {
        description:
          "List your Colosseum channels, including those owned by groups you're " +
          "in. Each carries the `handle` its link lives under.",
        inputSchema: {},
      },
      asTool(async (_args: Record<string, never>, { userId }) => ({
        channels: await getViewerChannels(await viewerScope(userId)),
      })),
    );

    server.registerTool(
      "whoami",
      {
        description:
          "The account this token belongs to: its `handle`, what its profile " +
          "shows, and its block allowance. Use it to name yourself — every " +
          "other tool is addressed by channel id or by a group handle from " +
          "list_groups — and to check `blocks` before adding a batch, since " +
          "create_block refuses once `used` reaches `limit`.",
        inputSchema: {},
      },
      asTool(async (_args: Record<string, never>, { userId }) => {
        const [profile, blocks] = await Promise.all([
          getUserProfile(userId),
          getColumnQuota(userId),
        ]);
        if (!profile) throw new Error("This account has not finished onboarding.");
        return {
          me: {
            handle: profile.handle,
            about: profile.about,
            avatar_url: profile.avatar_url,
            created_at: profile.created_at,
            // What create_block will refuse on, before it refuses. A null
            // limit is unlimited.
            blocks: { used: blocks.used, limit: blocks.limit },
          },
        };
      }),
    );

    server.registerTool(
      "list_groups",
      {
        description:
          "List the groups you're in, with your role in each. Use a group's " +
          "`handle` as `owner` on create_channel to make a channel it owns; " +
          "only the owner and admin roles may do that.",
        inputSchema: {},
      },
      asTool(async (_args: Record<string, never>, { userId }) => ({
        groups: (await listUserGroups(userId)).map((g) => ({
          handle: g.handle,
          name: g.name,
          about: g.about,
          role: g.role,
        })),
      })),
    );

    server.registerTool(
      "create_channel",
      {
        description:
          "Create a Colosseum channel. `access`: public (all read; you and " +
          "invited members add), open (all read, anyone adds), private (only you " +
          "and invited members read/add). `owner`: a group handle from " +
          "list_groups to make a channel that group owns; omit for your own.",
        inputSchema: {
          title: z.string(),
          description: z.string().optional(),
          access: z.enum(["public", "open", "private"]).optional(),
          private: z.boolean().optional(),
          owner: z.string().optional(),
        },
      },
      asTool(
        async (
          args: {
            title: string;
            description?: string;
            access?: "public" | "open" | "private";
            private?: boolean;
            owner?: string;
          },
          { userId },
        ) => {
          const title = args.title.trim();
          if (!title) throw new Error("`title` is required.");
          return {
            channel: await createChannel({
              title,
              description: args.description,
              access: parseAccess(args, "public"),
              owned_by: await resolveCreateOwner(userId, args.owner),
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
          access: z.enum(["public", "open", "private"]).optional(),
          private: z.boolean().optional(),
        },
      },
      asTool(
        async (
          args: {
            id: number;
            title?: string;
            description?: string;
            access?: "public" | "open" | "private";
            private?: boolean;
          },
          { userId },
        ) => {
          const channel = await requireChannel(userId, args.id, "manage");
          const title = args.title !== undefined ? args.title.trim() : channel.title;
          if (!title) throw new Error("`title` cannot be empty.");
          return {
            channel: await updateChannel(args.id, {
              title,
              description: args.description ?? channel.description,
              access: parseAccess(args, channel.access),
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
        await requireChannel(userId, id, "manage");
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
        const blocks = await getChannelColumns(
          channelId,
          { limit, html: false },
          await viewerScope(userId),
        );
        return { blocks: await attachPreviews(blocks) };
      }),
    );

    server.registerTool(
      "create_block",
      {
        description:
          "Add a block to a channel you can contribute to (one you own, any open " +
          "channel, or a public/private channel you're a member of). Exactly one " +
          "of text/url/image must match `type`. A url block's preview screenshot " +
          "captures in the background, so it comes back null here — poll get_block " +
          "until `preview` lands.",
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
          const channel = await requireChannel(userId, args.channelId, "contribute");
          const base = { created_by: userId, channel_id: args.channelId };

          if (args.type === "text") {
            if (!args.text?.trim()) throw new Error("`text` is required for a text block.");
            return {
              block: await attachPreview(await uploadTextColumn({ ...base, text: args.text })),
            };
          }
          if (args.type === "url") {
            if (!args.url?.trim()) throw new Error("`url` is required for a url block.");
            // uploadURLColumn stores its `text` arg as the block's url.
            const url = args.url.trim();
            const block = await attachPreview(await uploadURLColumn({ ...base, text: url }));
            // Fire-and-forget, same as the REST create path: the capture is
            // queued and deduped per URL, and the tool result returns now.
            triggerScreenshotCapture(url, userId);
            return { block };
          }
          if (!args.image?.trim())
            throw new Error("`image` (a public image URL) is required for an image block.");
          // Fetch and store the image so it's thumbnailed and self-hosted,
          // rather than persisting a third-party URL that skips compression.
          const image = await putImageBlobFromUrl(
            args.image.trim(),
            userId,
            channel.private ? "private" : "public",
          );
          return { block: await attachPreview(await uploadImageColumn({ ...base, image })) };
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
        block: await attachPreview(await requireBlock(userId, id, "read")),
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

          const updated = await attachPreview(await updateColumn(args.id, updates));
          // A new url means a new preview to capture; skips itself if this URL
          // is already cached.
          if (block.type === "url" && typeof updates.url === "string") {
            triggerScreenshotCapture(updates.url, userId);
          }
          return { block: updated };
        },
      ),
    );

    server.registerTool(
      "move_block",
      {
        description:
          "Move a block to another channel. You must own both the channel it is " +
          "in and the one it is going to. The block keeps its id, creation time, " +
          "title, description, tags, and any screenshot — unlike recreating it.",
        inputSchema: { id: z.number().int(), channelId: z.number().int() },
      },
      asTool(async ({ id, channelId }: { id: number; channelId: number }, { userId }) => {
        const moved = await moveBlock(id, channelId, userId);
        if (moved instanceof NextResponse) throw await denialToError(moved);
        return { block: await attachPreview(moved) };
      }),
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
