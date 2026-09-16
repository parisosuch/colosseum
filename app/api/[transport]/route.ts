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
  addMemberFor,
  copyBlock,
  createCommentFor,
  deleteCommentFor,
  leaveChannel,
  listCommentsFor,
  listMembersFor,
  moveBlock,
  nestChannel,
  parseAccess,
  removeMemberFor,
  reorderBlock,
  resolveApiToken,
} from "@/lib/colosseum/api-auth";
import {
  Channel,
  createChannel,
  searchChannels,
  deleteChannel,
  getChannel,
  getViewerChannels,
  getVisibleOwnerChannels,
  updateChannel,
  viewerScope,
} from "@/lib/colosseum/channel";
import { getOwnerByHandle, resolveCreateOwner } from "@/lib/colosseum/owner";
import { getColumnQuota } from "@/lib/colosseum/admin";
import { isHandleAvailable, updateProfile } from "@/lib/colosseum/profile";
import {
  HandleTakenError,
  getUserProfile,
  normalizeHandle,
  searchProfiles,
  validateHandle,
} from "@/lib/colosseum/user";
import { listUserGroups } from "@/lib/colosseum/group";
import {
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  setEmailNotificationPref,
  unreadNotificationCount,
  type NotificationType,
} from "@/lib/colosseum/notification";
import {
  Column,
  deleteColumn,
  getChannelColumnCount,
  getChannelColumns,
  getColumn,
  searchColumns,
  updateColumn,
  updateColumnTags,
  uploadImageColumn,
  uploadTextColumn,
  uploadURLColumn,
} from "@/lib/colosseum/column";
import { putImageBlobFromUrl } from "@/lib/colosseum/blob";
import { triggerScreenshotCapture } from "@/lib/colosseum/screenshot";
import { ingestUrlColumn } from "@/lib/colosseum/ingest";
import { parseColosseumLink } from "@/lib/colosseum/resolve";
import { normalizeTags } from "@/lib/tags";
import { SEARCH_LIMIT } from "@/lib/utils";
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
      "resolve",
      {
        description:
          "Turn a Colosseum link, or a bare handle, into the ids everything " +
          "else takes. Accepts a full URL, a host/path, a /path, or just a " +
          "handle. Use it whenever you are handed a link — every other tool " +
          "is addressed by numeric id, and list_channels only returns your " +
          "own. A private channel resolves to not-found unless you can read it.",
        inputSchema: { query: z.string() },
      },
      asTool(async ({ query }: { query: string }, { userId }) => {
        const link = parseColosseumLink(query);
        if (!link) throw new Error("Not a Colosseum link or handle.");

        const owner = await getOwnerByHandle(link.handle);
        if (!owner) throw new Error("Not found.");

        const result: Record<string, unknown> = {
          owner: { handle: owner.handle, kind: owner.kind, about: owner.about },
        };
        if (link.channelId !== undefined) {
          result.channel = await requireChannel(userId, link.channelId, "read");
          if (link.blockId !== undefined) {
            const block = await getColumn(link.blockId, { html: false });
            // Must be in the channel the link named; one that isn't is as good
            // as missing, and saying otherwise would confirm it exists.
            if (!block || block.channel_id !== link.channelId) throw new Error("Not found.");
            result.block = await attachPreview(block);
          }
        }
        return result;
      }),
    );

    server.registerTool(
      "list_owner_channels",
      {
        description:
          "The channels under a handle — a person's or a group's — whether or " +
          "not you own it, scoped to what you can see. list_channels returns " +
          "only your own; this is how you read anyone else's.",
        inputSchema: { handle: z.string() },
      },
      asTool(async ({ handle }: { handle: string }, { userId }) => {
        const owner = await getOwnerByHandle(handle);
        if (!owner) throw new Error("Not found.");
        return {
          owner: { handle: owner.handle, kind: owner.kind, about: owner.about },
          channels: await getVisibleOwnerChannels(owner.id, await viewerScope(userId)),
        };
      }),
    );

    server.registerTool(
      "search",
      {
        description:
          "Find people, channels and blocks matching a query, under your own " +
          "visibility — public things plus what you own or belong to. Use it " +
          "instead of listing channels and matching client-side: that pulls " +
          "most of a collection into the conversation to find one link. " +
          "`limit` is per kind, up to 50. To read a whole channel rather than " +
          "find something in it, page list_blocks.",
        inputSchema: {
          query: z.string(),
          limit: z.number().int().positive().max(50).optional(),
        },
      },
      asTool(async ({ query, limit }: { query: string; limit?: number }, { userId }) => {
        if (!query.trim()) throw new Error("`query` is required.");
        const n = limit ?? SEARCH_LIMIT;
        const viewer = await viewerScope(userId);
        const [profiles, channels, columns] = await Promise.all([
          searchProfiles(query, n),
          searchChannels(viewer, query, n),
          searchColumns(viewer, query, n),
        ]);
        return { profiles, channels, blocks: await attachPreviews(columns) };
      }),
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
      "update_profile",
      {
        description:
          "Edit your own profile: `handle`, `about` (the bio), and `avatar` " +
          "as a URL the server fetches. Changing your handle changes every " +
          "link to you, since a profile lives at /{handle} — check " +
          "check_handle first. Nothing here touches anyone else's account.",
        inputSchema: {
          handle: z.string().optional(),
          about: z.string().optional(),
          avatar: z.string().optional(),
        },
      },
      asTool(async (args: { handle?: string; about?: string; avatar?: string }, { userId }) => {
        const updates: { handle?: string; about?: string; avatar_url?: string } = {};
        if (args.handle !== undefined) {
          const handle = normalizeHandle(args.handle);
          const invalid = validateHandle(handle);
          if (invalid) throw new Error(invalid);
          updates.handle = handle;
        }
        if (args.about !== undefined) updates.about = args.about;

        const previous = await getUserProfile(userId);
        if (!previous) throw new Error("This account has not finished onboarding.");

        if (args.avatar?.trim()) {
          // Public scope: an avatar shows wherever the account is named.
          updates.avatar_url = await putImageBlobFromUrl(args.avatar.trim(), userId, "public");
        }
        if (Object.keys(updates).length === 0) {
          throw new Error("Nothing to update. Allowed: handle, about, avatar.");
        }

        try {
          const profile = await updateProfile(userId, previous, updates);
          return {
            me: {
              handle: profile.handle,
              about: profile.about,
              avatar_url: profile.avatar_url,
              created_at: profile.created_at,
            },
          };
        } catch (e) {
          if (e instanceof HandleTakenError) throw new Error("That handle is already taken.");
          throw e;
        }
      }),
    );

    server.registerTool(
      "check_handle",
      {
        description:
          "Whether a handle is free to claim. `available: null` means it isn't " +
          "a valid handle at all, which is a different answer from taken. " +
          "People and groups share one namespace, so a handle a group holds is " +
          "not available to you.",
        inputSchema: { handle: z.string() },
      },
      asTool(async ({ handle }: { handle: string }) => {
        const available = await isHandleAvailable(handle);
        return available === null
          ? { available: null, reason: "Not a valid handle." }
          : { available };
      }),
    );

    server.registerTool(
      "list_notifications",
      {
        description:
          "What has happened to your account: comments on your blocks, " +
          "mentions of you, channels of yours nested elsewhere, and channels " +
          "you were added to. `unreadOnly` narrows it; `before` pages back " +
          "using the `at` of the last one you saw. `unread` in the result is " +
          "the whole count, not the page's.",
        inputSchema: {
          before: z.string().optional(),
          unreadOnly: z.boolean().optional(),
        },
      },
      asTool(
        async ({ before, unreadOnly }: { before?: string; unreadOnly?: boolean }, { userId }) => {
          const [notifications, unread] = await Promise.all([
            listNotifications(userId, before, { unreadOnly: unreadOnly ?? false }),
            unreadNotificationCount(userId),
          ]);
          return { notifications, unread };
        },
      ),
    );

    server.registerTool(
      "mark_notifications_read",
      {
        description:
          "Mark one notification read by id, or all of them when `id` is " +
          "omitted. Reading the list does not mark anything.",
        inputSchema: { id: z.number().int().optional() },
      },
      asTool(async ({ id }: { id?: number }, { userId }) => {
        if (id === undefined) {
          await markAllNotificationsRead(userId);
          return { markedAll: true };
        }
        // Scoped to you as recipient, so someone else's id matches nothing
        // rather than reporting whether it exists.
        await markNotificationRead(userId, id);
        return { marked: id };
      }),
    );

    server.registerTool(
      "set_email_notification",
      {
        description:
          "Turn email on or off for one kind of notification. The in-app " +
          "notifications keep arriving either way — this only decides whether " +
          "they are also mailed to you.",
        inputSchema: {
          type: z.enum(["comment", "mention", "connect", "member"]),
          enabled: z.boolean(),
        },
      },
      asTool(
        async ({ type, enabled }: { type: NotificationType; enabled: boolean }, { userId }) => ({
          email_notifications: await setEmailNotificationPref(userId, type, enabled),
        }),
      ),
    );

    server.registerTool(
      "list_comments",
      {
        description:
          "What has been said about a block. Visible to anyone who can read " + "the block.",
        inputSchema: { blockId: z.number().int() },
      },
      asTool(async ({ blockId }: { blockId: number }, { userId }) => {
        const result = await listCommentsFor(blockId, userId);
        if (result instanceof NextResponse) throw await denialToError(result);
        return { comments: result };
      }),
    );

    server.registerTool(
      "create_comment",
      {
        description:
          "Leave a comment on a block. Any reader may comment, not just the " +
          "channel's owner. `@handle` in the text notifies that person, but " +
          "only if they can read the channel — a mention never leaks a private " +
          "channel's contents to someone outside it.",
        inputSchema: { blockId: z.number().int(), body: z.string() },
      },
      asTool(async ({ blockId, body }: { blockId: number; body: string }, { userId }) => {
        const result = await createCommentFor(blockId, body, userId);
        if (result instanceof NextResponse) throw await denialToError(result);
        return { comment: result };
      }),
    );

    server.registerTool(
      "delete_comment",
      {
        description:
          "Remove a comment. Its author always may; otherwise the block's " +
          "channel owner may moderate it.",
        inputSchema: { commentId: z.number().int() },
      },
      asTool(async ({ commentId }: { commentId: number }, { userId }) => {
        const denial = await deleteCommentFor(commentId, userId);
        if (denial) throw await denialToError(denial);
        return { deleted: commentId };
      }),
    );

    server.registerTool(
      "list_members",
      {
        description:
          "Who is on a channel's roster. Visible to anyone who can read the " +
          "channel — the channel page shows the same list.",
        inputSchema: { channelId: z.number().int() },
      },
      asTool(async ({ channelId }: { channelId: number }, { userId }) => {
        const result = await listMembersFor(channelId, userId);
        if (result instanceof NextResponse) throw await denialToError(result);
        return { members: result };
      }),
    );

    server.registerTool(
      "add_member",
      {
        description:
          "Add someone to a channel by handle, which is how a private channel " +
          "gets shared. Channel owners only; the person added is notified. " +
          "Adding someone already on the roster changes nothing and sends no " +
          "second notification.",
        inputSchema: { channelId: z.number().int(), handle: z.string() },
      },
      asTool(async ({ channelId, handle }: { channelId: number; handle: string }, { userId }) => {
        const result = await addMemberFor(channelId, handle, userId);
        if (result instanceof NextResponse) throw await denialToError(result);
        return { member: result };
      }),
    );

    server.registerTool(
      "remove_member",
      {
        description:
          "Take someone off a channel's roster, by handle. Channel owners " +
          "only. To give up your own membership use leave_channel instead, " +
          "which any member may do.",
        inputSchema: { channelId: z.number().int(), handle: z.string() },
      },
      asTool(async ({ channelId, handle }: { channelId: number; handle: string }, { userId }) => {
        const denial = await removeMemberFor(channelId, handle, userId);
        if (denial) throw await denialToError(denial);
        return { removed: handle };
      }),
    );

    server.registerTool(
      "leave_channel",
      {
        description:
          "Give up your membership of a channel someone else owns. You cannot " +
          "leave one you manage — delete it or hand it on instead.",
        inputSchema: { channelId: z.number().int() },
      },
      asTool(async ({ channelId }: { channelId: number }, { userId }) => {
        const denial = await leaveChannel(channelId, userId);
        if (denial) throw await denialToError(denial);
        return { left: channelId };
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
        description:
          "List a channel's blocks (public or owned), newest first. `limit` " +
          "and `offset` page through them, and `total` is the channel's whole " +
          "count — so a channel bigger than one page can be read to the end " +
          "rather than sampled from the top.",
        inputSchema: {
          channelId: z.number().int(),
          limit: z.number().int().positive().optional(),
          offset: z.number().int().nonnegative().optional(),
        },
      },
      asTool(
        async (
          { channelId, limit, offset }: { channelId: number; limit?: number; offset?: number },
          { userId },
        ) => {
          await requireChannel(userId, channelId, "read");
          const [blocks, total] = await Promise.all([
            getChannelColumns(channelId, { limit, offset, html: false }, await viewerScope(userId)),
            getChannelColumnCount(channelId),
          ]);
          return { blocks: await attachPreviews(blocks), total };
        },
      ),
    );

    server.registerTool(
      "nest_channel",
      {
        description:
          "Add a channel as a block inside one of your channels — the " +
          "Are.na-style link. This is the one block type create_block cannot " +
          "make. `linkedChannelId` must be a public or open channel (a private " +
          "one is not found), and cannot be the host itself. You must own the " +
          "host; its owner is notified unless the host is private.",
        inputSchema: { linkedChannelId: z.number().int(), hostChannelId: z.number().int() },
      },
      asTool(
        async (
          { linkedChannelId, hostChannelId }: { linkedChannelId: number; hostChannelId: number },
          { userId },
        ) => {
          const result = await nestChannel(linkedChannelId, hostChannelId, userId);
          if (result instanceof NextResponse) throw await denialToError(result);
          return { block: await attachPreview(result) };
        },
      ),
    );

    server.registerTool(
      "copy_block",
      {
        description:
          "Put a copy of a block in another channel, leaving the original " +
          "where it is. You need only to be able to see the source, and to be " +
          "able to add to the target — so anyone's block from a channel you " +
          "can read may be copied into yours. The copy is a new block with its " +
          "own id and its own media, so deleting either leaves the other whole. " +
          "Use move_block instead to take a block out of where it is.",
        inputSchema: { id: z.number().int(), channelId: z.number().int() },
      },
      asTool(async ({ id, channelId }: { id: number; channelId: number }, { userId }) => {
        const result = await copyBlock(id, channelId, userId);
        if (result instanceof NextResponse) throw await denialToError(result);
        return { block: await attachPreview(result) };
      }),
    );

    server.registerTool(
      "reorder_block",
      {
        description:
          "Place a block in its channel's manual order. `after` is the id of " +
          "the block it should sit behind, or null to put it first. Both must " +
          "be in the same channel. Channel owners only — a reorder rearranges " +
          "everyone's blocks, unlike editing one you added. The anchor is a " +
          "block id rather than a position number, so it stays correct even if " +
          "the channel changed since you listed it.",
        inputSchema: {
          id: z.number().int(),
          after: z.number().int().nullable(),
        },
      },
      asTool(async ({ id, after }: { id: number; after: number | null }, { userId }) => {
        const result = await reorderBlock(id, after, userId);
        if (result instanceof NextResponse) throw await denialToError(result);
        return { block: await attachPreview(result) };
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
          "until `preview` lands. Optional `tags` are alphanumeric with dashes; " +
          "anything else is stripped.\n\n" +
          "A url is ingested as what it points at: a tweet, a YouTube video or " +
          "channel, a Spotify item, a GitHub repo or account, an Instagram post, " +
          "or a direct image each become that kind of block, with its details " +
          "fetched and stored. Anything else stays a plain link with a " +
          "screenshot. The returned block's `type` says which it became — it is " +
          "often not `url`. Pass `detect: false` to force a plain link block.",
        inputSchema: {
          channelId: z.number().int(),
          type: z.enum(["text", "url", "image"]),
          text: z.string().optional(),
          url: z.string().optional(),
          image: z.string().optional(),
          tags: z.array(z.string()).optional(),
          detect: z.boolean().optional(),
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
            tags?: string[];
            detect?: boolean;
          },
          { userId },
        ) => {
          const channel = await requireChannel(userId, args.channelId, "contribute");
          const base = { created_by: userId, channel_id: args.channelId };

          // The three creates funnel into one variable so tags are applied once
          // at the end, rather than repeated down each branch.
          let created: Column;
          if (args.type === "text") {
            if (!args.text?.trim()) throw new Error("`text` is required for a text block.");
            created = await uploadTextColumn({ ...base, text: args.text });
          } else if (args.type === "url") {
            if (!args.url?.trim()) throw new Error("`url` is required for a url block.");
            const url = args.url.trim();
            // A tweet, a YouTube video, a GitHub repo and so on each become
            // their own kind of block, the same as a link pasted into the web
            // app. `detect: false` keeps it a plain link.
            created =
              args.detect === false
                ? await uploadURLColumn({ ...base, text: url })
                : await ingestUrlColumn({
                    url,
                    userId,
                    channelId: args.channelId,
                    channelPrivate: channel.private,
                  });
            // Only a block that stayed a plain link wants a screenshot; the
            // richer types render from data fetched during the ingest.
            // Fire-and-forget, same as the REST create path: the capture is
            // queued and deduped per URL, and the tool result returns now.
            if (created.type === "url") triggerScreenshotCapture(url, userId);
          } else {
            if (!args.image?.trim())
              throw new Error("`image` (a public image URL) is required for an image block.");
            // Fetch and store the image so it's thumbnailed and self-hosted,
            // rather than persisting a third-party URL that skips compression.
            const image = await putImageBlobFromUrl(
              args.image.trim(),
              userId,
              channel.private ? "private" : "public",
            );
            created = await uploadImageColumn({ ...base, image });
          }

          // The upload helpers take no tags, so this is a second write — the
          // same two steps the web app makes when adding a block and tagging it.
          const tags = args.tags ? normalizeTags(args.tags) : [];
          if (tags.length > 0) {
            await updateColumnTags(created.id, tags);
            created = (await getColumn(created.id, { html: false })) ?? created;
          }
          return { block: await attachPreview(created) };
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
        description:
          "Update a block in a channel you own. Omitted fields are unchanged. " +
          "`tags` replaces the whole list, so pass the tags you want to keep; " +
          "an empty array clears them. Tags are alphanumeric with dashes — " +
          "anything else is stripped.",
        inputSchema: {
          id: z.number().int(),
          title: z.string().optional(),
          description: z.string().optional(),
          text: z.string().optional(),
          url: z.string().optional(),
          image: z.string().optional(),
          tags: z.array(z.string()).optional(),
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
            tags?: string[];
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
          // Tags are a string[] on every type, so they're written separately
          // from the field loop. Presence is what counts — `[]` clears them.
          const tags = args.tags !== undefined ? normalizeTags(args.tags) : null;
          if (Object.keys(updates).length === 0 && tags === null) {
            throw new Error(`No editable fields provided. Allowed: ${allowed.join(", ")}, tags.`);
          }
          if (tags !== null) await updateColumnTags(args.id, tags);

          const updated = await attachPreview(
            Object.keys(updates).length > 0
              ? await updateColumn(args.id, updates)
              : (await getColumn(args.id, { html: false }))!,
          );
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
