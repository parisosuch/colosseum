import { beforeAll, expect, test } from "bun:test";
import { NextResponse } from "next/server";

import { seed, USERS } from "@/scripts/seed";
import {
  addGroupMemberFor,
  addMemberFor,
  adminDeleteBlock,
  authorizeAdmin,
  attachPreview,
  attachPreviews,
  copyBlock,
  createCommentFor,
  createApiToken,
  createGroupFor,
  createInviteCodeFor,
  deleteCommentFor,
  listCommentsFor,
  listApiTokensFor,
  listGroupMembersFor,
  listMembersFor,
  leaveChannel,
  moveBlock,
  nestChannel,
  removeGroupMemberFor,
  removeMemberFor,
  reorderBlock,
  revokeInviteCodeFor,
  setGroupRoleFor,
  transferChannelFor,
} from "./api-auth";
import { createMedia, putBlob } from "./blob";
import { getMyInviteCodes } from "./invite";
import { redactSettings } from "./admin";
import { createChannel } from "./channel";
import {
  Column,
  getChannelColumns,
  getColumn,
  uploadImageColumn,
  uploadTextColumn,
  uploadURLColumn,
} from "./column";
import { addChannelMemberByHandle, isChannelMember } from "./member";
import { getScreenshot, upsertScreenshot } from "./screenshot-data";

beforeAll(async () => {
  await seed();
});

// The api-auth helpers return either a result or a denial NextResponse; this
// pulls the status + message out of the denial the way the REST API and the MCP
// tool (via denialToError) do. Typed on `unknown` because the helpers return
// different result types — a Column, a Comment, a member row — and only the
// denial branch is read here.
async function denial(result: unknown): Promise<{ status: number; error: string }> {
  expect(result).toBeInstanceOf(NextResponse);
  const res = result as NextResponse;
  const body = (await res.json()) as { error?: string };
  return { status: res.status, error: body.error ?? "" };
}

test("moveBlock reassigns the block, keeping its id, created_at, and screenshot", async () => {
  const src = await createChannel({
    title: "From",
    access: "public",
    owned_by: USERS.alice.ownerId,
  });
  const dst = await createChannel({
    title: "To",
    access: "private",
    owned_by: USERS.alice.ownerId,
  });

  const url = "https://ponytail.example/move-test";
  const block = await uploadURLColumn({
    created_by: USERS.alice.id,
    channel_id: src.id,
    text: url,
  });

  // A url block's preview lives in the shared per-URL screenshot cache, so the
  // move must leave it resolvable — that's the thing create-then-delete loses.
  const sha = await putBlob(Buffer.from("move-test-bytes"), "image/png", USERS.alice.id);
  const imageUrl = await createMedia(sha, USERS.alice.id, "public");
  await upsertScreenshot({ url, image_url: imageUrl, title: "t", description: "d" });

  const moved = await moveBlock(block.id, dst.id, USERS.alice.id);
  expect(moved).not.toBeInstanceOf(NextResponse);
  const result = moved as Column;

  expect(result.id).toBe(block.id);
  expect(result.created_at).toBe(block.created_at);
  expect(result.created_by).toBe(block.created_by);
  expect(result.url).toBe(url);
  expect(result.channel_id).toBe(dst.id);

  expect((await getChannelColumns(src.id)).map((c) => c.id)).not.toContain(block.id);
  expect((await getChannelColumns(dst.id)).map((c) => c.id)).toContain(block.id);
  expect((await getScreenshot(url))?.image_url).toBe(imageUrl);
});

test("moveBlock into the block's current channel is a no-op that returns it unchanged", async () => {
  const ch = await createChannel({
    title: "Stay",
    access: "public",
    owned_by: USERS.alice.ownerId,
  });
  const block = await uploadTextColumn({
    created_by: USERS.alice.id,
    channel_id: ch.id,
    text: "here already",
  });

  const moved = await moveBlock(block.id, ch.id, USERS.alice.id);
  expect((moved as Column).channel_id).toBe(ch.id);
  expect((await getChannelColumns(ch.id)).map((c) => c.id)).toEqual([block.id]);
});

test("moveBlock refuses a source channel the caller does not own", async () => {
  // Bob's channel is public, so Alice can read it — but not move things out.
  const src = await createChannel({
    title: "Bob's",
    access: "public",
    owned_by: USERS.bob.ownerId,
  });
  const dst = await createChannel({
    title: "Alice's",
    access: "public",
    owned_by: USERS.alice.ownerId,
  });
  const block = await uploadTextColumn({
    created_by: USERS.bob.id,
    channel_id: src.id,
    text: "bob's block",
  });

  const { status, error } = await denial(await moveBlock(block.id, dst.id, USERS.alice.id));
  expect(status).toBe(403);
  expect(error).toBe("You do not have permission to modify this resource.");
  expect((await getChannelColumns(src.id)).map((c) => c.id)).toContain(block.id);
});

test("moveBlock refuses a destination the caller does not own", async () => {
  const src = await createChannel({
    title: "Mine",
    access: "public",
    owned_by: USERS.alice.ownerId,
  });
  const dst = await createChannel({
    title: "Theirs",
    access: "public",
    owned_by: USERS.bob.ownerId,
  });
  const block = await uploadTextColumn({
    created_by: USERS.alice.id,
    channel_id: src.id,
    text: "alice's block",
  });

  const { status, error } = await denial(await moveBlock(block.id, dst.id, USERS.alice.id));
  expect(status).toBe(403);
  expect(error).toBe("You do not have permission to modify this resource.");
  expect((await getChannelColumns(src.id)).map((c) => c.id)).toContain(block.id);
});

test("moveBlock 404s on a private destination, so it never confirms one exists", async () => {
  const src = await createChannel({
    title: "Src",
    access: "public",
    owned_by: USERS.alice.ownerId,
  });
  const dst = await createChannel({
    title: "Hidden",
    access: "private",
    owned_by: USERS.bob.ownerId,
  });
  const block = await uploadTextColumn({
    created_by: USERS.alice.id,
    channel_id: src.id,
    text: "block",
  });

  expect(await denial(await moveBlock(block.id, dst.id, USERS.alice.id))).toEqual({
    status: 404,
    error: "Not found.",
  });
});

test("moveBlock 404s on a missing block or a missing destination channel", async () => {
  const src = await createChannel({
    title: "Src",
    access: "public",
    owned_by: USERS.alice.ownerId,
  });
  const block = await uploadTextColumn({
    created_by: USERS.alice.id,
    channel_id: src.id,
    text: "block",
  });

  expect(await denial(await moveBlock(999_999_999, src.id, USERS.alice.id))).toEqual({
    status: 404,
    error: "Not found.",
  });
  expect(await denial(await moveBlock(block.id, 999_999_999, USERS.alice.id))).toEqual({
    status: 404,
    error: "Not found.",
  });
});

test("nestChannel links a channel as a block in the host", async () => {
  const host = await createChannel({
    title: "Host",
    access: "public",
    owned_by: USERS.alice.ownerId,
  });
  const linked = await createChannel({
    title: "Linked",
    access: "public",
    owned_by: USERS.bob.ownerId,
  });

  const block = (await nestChannel(linked.id, host.id, USERS.alice.id)) as Column;
  expect(block).not.toBeInstanceOf(NextResponse);
  expect(block.type).toBe("channel");
  expect(block.linked_channel_id).toBe(linked.id);
  expect(block.channel_id).toBe(host.id);
});

test("nestChannel needs ownership of the host, not just contribute", async () => {
  // Open, so Alice may add blocks — but nesting puts a permanent link to
  // someone's collection here and notifies them, which is the owner's call.
  const host = await createChannel({
    title: "Bob's open host",
    access: "open",
    owned_by: USERS.bob.ownerId,
  });
  const linked = await createChannel({
    title: "Linkable",
    access: "public",
    owned_by: USERS.alice.ownerId,
  });

  const { status } = await denial(await nestChannel(linked.id, host.id, USERS.alice.id));
  expect(status).toBe(403);
});

test("nestChannel 404s on a private linked channel and refuses a self-nest", async () => {
  const host = await createChannel({
    title: "Host",
    access: "public",
    owned_by: USERS.alice.ownerId,
  });
  const secret = await createChannel({
    title: "Bob's private",
    access: "private",
    owned_by: USERS.bob.ownerId,
  });

  // 404 rather than 403: a distinguishable refusal would confirm it exists.
  expect(await denial(await nestChannel(secret.id, host.id, USERS.alice.id))).toEqual({
    status: 404,
    error: "Not found.",
  });

  const self = await denial(await nestChannel(host.id, host.id, USERS.alice.id));
  expect(self.status).toBe(400);
  expect(self.error).toContain("itself");
});

test("copyBlock leaves the original and gives the copy its own media", async () => {
  const src = await createChannel({
    title: "Source",
    access: "public",
    owned_by: USERS.bob.ownerId,
  });
  const dst = await createChannel({
    title: "Target",
    access: "private",
    owned_by: USERS.alice.ownerId,
  });

  const sha = await putBlob(Buffer.from("copy-test-bytes"), "image/png", USERS.bob.id);
  const image = await createMedia(sha, USERS.bob.id, "public");
  const source = await uploadImageColumn({
    created_by: USERS.bob.id,
    channel_id: src.id,
    image,
  });

  // Alice can only read Bob's channel, which is all copying needs.
  const copy = (await copyBlock(source.id, dst.id, USERS.alice.id)) as Column;
  expect(copy).not.toBeInstanceOf(NextResponse);

  expect(copy.id).not.toBe(source.id);
  expect(copy.channel_id).toBe(dst.id);
  expect(copy.created_by).toBe(USERS.alice.id);
  // A fresh media reference, not the source's — otherwise deleting either block
  // would dangle the other's image, and a copy into a private channel would
  // keep pointing at public media.
  expect(copy.image).not.toBe(source.image);
  // The original stays where it was.
  expect((await getChannelColumns(src.id)).map((c) => c.id)).toContain(source.id);
});

test("copyBlock needs only read on the source, but contribute on the target", async () => {
  const src = await createChannel({
    title: "Readable",
    access: "public",
    owned_by: USERS.bob.ownerId,
  });
  const dst = await createChannel({
    title: "Not Alice's",
    access: "public",
    owned_by: USERS.bob.ownerId,
  });
  const block = await uploadTextColumn({
    created_by: USERS.bob.id,
    channel_id: src.id,
    text: "bob's",
  });

  // A public channel is readable by all but only its owner and members may add,
  // so the target is what refuses — the source being someone else's is fine.
  const { status } = await denial(await copyBlock(block.id, dst.id, USERS.alice.id));
  expect(status).toBe(403);
});

test("copyBlock 404s on a source in a private channel the caller cannot read", async () => {
  const src = await createChannel({
    title: "Bob's private",
    access: "private",
    owned_by: USERS.bob.ownerId,
  });
  const dst = await createChannel({
    title: "Alice's",
    access: "public",
    owned_by: USERS.alice.ownerId,
  });
  const block = await uploadTextColumn({
    created_by: USERS.bob.id,
    channel_id: src.id,
    text: "secret",
  });

  expect(await denial(await copyBlock(block.id, dst.id, USERS.alice.id))).toEqual({
    status: 404,
    error: "Not found.",
  });
});

test("reorderBlock places a block after its anchor", async () => {
  const ch = await createChannel({
    title: "Ordered",
    access: "public",
    owned_by: USERS.alice.ownerId,
  });
  const mk = (text: string) =>
    uploadTextColumn({ created_by: USERS.alice.id, channel_id: ch.id, text });
  const first = await mk("a");
  const second = await mk("b");
  const third = await mk("c");

  // Newest-first by default, so the channel reads c, b, a.
  const moved = await reorderBlock(third.id, first.id, USERS.alice.id);
  expect(moved).not.toBeInstanceOf(NextResponse);

  const order = (await getChannelColumns(ch.id, { sort: "manual" })).map((c) => c.id);
  expect(order).toEqual([second.id, first.id, third.id]);
});

test("reorderBlock is owner-only, unlike editing a block you added", async () => {
  // Bob's channel is open, so Alice may add to it and edit what she added —
  // but rearranging it moves everyone's blocks, so it follows ownership.
  const ch = await createChannel({
    title: "Bob's open channel",
    access: "open",
    owned_by: USERS.bob.ownerId,
  });
  const bobs = await uploadTextColumn({
    created_by: USERS.bob.id,
    channel_id: ch.id,
    text: "bob's",
  });
  const alices = await uploadTextColumn({
    created_by: USERS.alice.id,
    channel_id: ch.id,
    text: "alice's",
  });

  const result = await reorderBlock(alices.id, bobs.id, USERS.alice.id);
  expect(result).toBeInstanceOf(NextResponse);
  expect((result as NextResponse).status).toBe(403);
});

test("reorderBlock 404s on an anchor in another channel", async () => {
  const here = await createChannel({
    title: "Here",
    access: "public",
    owned_by: USERS.alice.ownerId,
  });
  const elsewhere = await createChannel({
    title: "Elsewhere",
    access: "public",
    owned_by: USERS.alice.ownerId,
  });
  const block = await uploadTextColumn({
    created_by: USERS.alice.id,
    channel_id: here.id,
    text: "x",
  });
  const foreign = await uploadTextColumn({
    created_by: USERS.alice.id,
    channel_id: elsewhere.id,
    text: "y",
  });

  // A position key only orders a block against its own channel's keys, so an
  // anchor from elsewhere has nothing to be placed relative to.
  const result = await reorderBlock(block.id, foreign.id, USERS.alice.id);
  expect((result as NextResponse).status).toBe(404);
});

// leaveChannel returns null on success and a denial NextResponse otherwise, so
// it needs its own reader — `denial` above is typed for moveBlock's return.
async function leaveDenial(
  result: NextResponse | null,
): Promise<{ status: number; error: string }> {
  expect(result).toBeInstanceOf(NextResponse);
  const res = result as NextResponse;
  const body = (await res.json()) as { error?: string };
  return { status: res.status, error: body.error ?? "" };
}

test("leaveChannel drops the caller's membership", async () => {
  const channel = await createChannel({
    title: "Bob's, with Alice in it",
    access: "private",
    owned_by: USERS.bob.ownerId,
  });
  await addChannelMemberByHandle(channel.id, USERS.alice.handle);
  expect(await isChannelMember(channel.id, USERS.alice.id)).toBe(true);

  expect(await leaveChannel(channel.id, USERS.alice.id)).toBeNull();
  expect(await isChannelMember(channel.id, USERS.alice.id)).toBe(false);
});

test("leaveChannel refuses the owner, who has no membership to give up", async () => {
  const channel = await createChannel({
    title: "Alice's own",
    access: "public",
    owned_by: USERS.alice.ownerId,
  });

  // Without this guard removeChannelMember deletes nothing and reports success,
  // leaving the owner believing they left a channel they still own.
  const { status, error } = await leaveDenial(await leaveChannel(channel.id, USERS.alice.id));
  expect(status).toBe(409);
  expect(error).toContain("manage this channel");
});

test("leaveChannel refuses someone who was never a member", async () => {
  const channel = await createChannel({
    title: "Bob's, without Alice",
    access: "public",
    owned_by: USERS.bob.ownerId,
  });

  const { status, error } = await leaveDenial(await leaveChannel(channel.id, USERS.alice.id));
  expect(status).toBe(409);
  expect(error).toContain("not a member");
});

test("leaveChannel 404s on a private channel the caller cannot read", async () => {
  const channel = await createChannel({
    title: "Bob's secret",
    access: "private",
    owned_by: USERS.bob.ownerId,
  });

  // A 409 here would confirm the channel exists to someone with no access.
  const { status } = await leaveDenial(await leaveChannel(channel.id, USERS.alice.id));
  expect(status).toBe(404);
});

test("API block payloads carry the markdown source, not the rendered HTML", async () => {
  const ch = await createChannel({ title: "Api", access: "public", owned_by: USERS.alice.ownerId });
  const block = await uploadTextColumn({
    created_by: USERS.alice.id,
    channel_id: ch.id,
    text: "# hi",
  });
  // The write path still renders, because the web client prepends the returned
  // block straight into the grid.
  expect(block.html).toContain("<h1>hi</h1>");

  // The API doesn't: a client that asked for the source gets the source, and
  // the rendered copy would roughly double a text block's payload.
  const single = await attachPreview(block);
  expect(single.text).toBe("# hi");
  expect("html" in single).toBe(false);

  const [listed] = await attachPreviews([block]);
  expect(listed.text).toBe("# hi");
  expect("html" in listed).toBe(false);
});

test("addMemberFor puts someone on the roster; listMembersFor needs only read", async () => {
  const ch = await createChannel({
    title: "Roster",
    access: "private",
    owned_by: USERS.bob.ownerId,
  });

  const added = await addMemberFor(ch.id, USERS.alice.handle, USERS.bob.id);
  expect(added).not.toBeInstanceOf(NextResponse);
  expect(await isChannelMember(ch.id, USERS.alice.id)).toBe(true);

  // Alice can now read the channel, so she can see who else is on it.
  const listed = await listMembersFor(ch.id, USERS.alice.id);
  expect(listed).not.toBeInstanceOf(NextResponse);
  expect((listed as { handle: string }[]).map((m) => m.handle)).toContain(USERS.alice.handle);
});

test("addMemberFor refuses a non-owner and reports a bad handle as a 400", async () => {
  const ch = await createChannel({
    title: "Bob's roster",
    access: "public",
    owned_by: USERS.bob.ownerId,
  });

  const notOwner = await addMemberFor(ch.id, USERS.alice.handle, USERS.alice.id);
  expect((notOwner as NextResponse).status).toBe(403);

  // A handle nobody has is the caller's mistake, not a server fault.
  const badHandle = await addMemberFor(ch.id, "nobody-by-that-name", USERS.bob.id);
  expect((badHandle as NextResponse).status).toBe(400);
});

test("removeMemberFor takes someone off, and is owner-only", async () => {
  const ch = await createChannel({
    title: "Removable",
    access: "private",
    owned_by: USERS.bob.ownerId,
  });
  await addMemberFor(ch.id, USERS.alice.handle, USERS.bob.id);

  // A member can't clear the roster — that's leaveChannel's job for themselves.
  const byMember = await removeMemberFor(ch.id, USERS.alice.handle, USERS.alice.id);
  expect((byMember as NextResponse).status).toBe(403);
  expect(await isChannelMember(ch.id, USERS.alice.id)).toBe(true);

  expect(await removeMemberFor(ch.id, USERS.alice.handle, USERS.bob.id)).toBeNull();
  expect(await isChannelMember(ch.id, USERS.alice.id)).toBe(false);
});

test("createCommentFor lets any reader comment, and lists back", async () => {
  const ch = await createChannel({
    title: "Commentable",
    access: "public",
    owned_by: USERS.bob.ownerId,
  });
  const block = await uploadTextColumn({
    created_by: USERS.bob.id,
    channel_id: ch.id,
    text: "a block",
  });

  // Alice doesn't own the channel — commenting is what a reader does.
  const posted = await createCommentFor(block.id, "nice one", USERS.alice.id);
  expect(posted).not.toBeInstanceOf(NextResponse);

  const listed = await listCommentsFor(block.id, USERS.alice.id);
  expect((listed as { body: string }[]).map((c) => c.body)).toContain("nice one");
});

test("createCommentFor rejects an empty comment as the caller's mistake", async () => {
  const ch = await createChannel({
    title: "Empty",
    access: "public",
    owned_by: USERS.alice.ownerId,
  });
  const block = await uploadTextColumn({
    created_by: USERS.alice.id,
    channel_id: ch.id,
    text: "b",
  });

  const { status } = await denial(await createCommentFor(block.id, "   ", USERS.alice.id));
  expect(status).toBe(400);
});

test("deleteCommentFor: the author may, a stranger may not, the channel owner may", async () => {
  const ch = await createChannel({
    title: "Moderated",
    access: "open",
    owned_by: USERS.bob.ownerId,
  });
  const block = await uploadTextColumn({
    created_by: USERS.bob.id,
    channel_id: ch.id,
    text: "c",
  });

  const mine = (await createCommentFor(block.id, "mine", USERS.alice.id)) as { id: number };
  // Its author, always.
  expect(await deleteCommentFor(mine.id, USERS.alice.id)).toBeNull();

  const theirs = (await createCommentFor(block.id, "bob's", USERS.bob.id)) as { id: number };
  // Alice can read the channel but neither wrote this nor owns the channel.
  const refused = await deleteCommentFor(theirs.id, USERS.alice.id);
  expect((refused as NextResponse).status).toBe(403);

  // The channel's owner moderates it.
  expect(await deleteCommentFor(theirs.id, USERS.bob.id)).toBeNull();
});

test("group roster: add, set a role, and remove — all by handle", async () => {
  const handle = `api-grp-${Date.now().toString(36)}`;
  const group = await createGroupFor(handle, "API Group", USERS.bob.id);
  expect(group).not.toBeInstanceOf(NextResponse);

  const added = await addGroupMemberFor(handle, USERS.alice.handle, "member", USERS.bob.id);
  expect(added).not.toBeInstanceOf(NextResponse);

  expect(await setGroupRoleFor(handle, USERS.alice.handle, "admin", USERS.bob.id)).toBeNull();
  const listed = await listGroupMembersFor(handle, USERS.alice.id);
  expect(
    (listed as { handle: string; role: string }[]).find((m) => m.handle === USERS.alice.handle)
      ?.role,
  ).toBe("admin");

  expect(await removeGroupMemberFor(handle, USERS.alice.handle, USERS.bob.id)).toBeNull();
});

test("a group the caller isn't in is 404, not 403", async () => {
  const handle = `api-grp-private-${Date.now().toString(36)}`;
  await createGroupFor(handle, "Not Alice's", USERS.bob.id);

  // A distinguishable refusal would confirm the group exists.
  expect(((await listGroupMembersFor(handle, USERS.alice.id)) as NextResponse).status).toBe(404);
  const denied = await addGroupMemberFor(handle, USERS.alice.handle, "member", USERS.alice.id);
  expect((denied as NextResponse).status).toBe(404);
});

test("createGroupFor reports a taken handle as a conflict", async () => {
  const handle = `api-grp-dup-${Date.now().toString(36)}`;
  await createGroupFor(handle, "First", USERS.bob.id);
  const second = await createGroupFor(handle, "Second", USERS.alice.id);
  expect((second as NextResponse).status).toBe(409);
});

test("transferChannelFor moves a channel to a group the caller administers", async () => {
  const handle = `api-grp-xfer-${Date.now().toString(36)}`;
  await createGroupFor(handle, "Receiving", USERS.alice.id);
  const ch = await createChannel({
    title: "Handed over",
    access: "public",
    owned_by: USERS.alice.ownerId,
  });

  const moved = await transferChannelFor(ch.id, handle, USERS.alice.id);
  expect(moved).not.toBeInstanceOf(NextResponse);

  // Bob neither owns the channel nor administers anything it could go to.
  const refused = await transferChannelFor(ch.id, USERS.bob.handle, USERS.bob.id);
  expect(refused).toBeInstanceOf(NextResponse);
});

test("invite codes: mint, list with the quota, then revoke", async () => {
  const minted = await createInviteCodeFor(USERS.alice.id, 2, "for a friend");
  expect(minted).not.toBeInstanceOf(NextResponse);
  const code = (minted as { code: string }).code;

  const listed = await getMyInviteCodes(USERS.alice.id);
  expect(listed.map((i) => i.code)).toContain(code);

  expect(await revokeInviteCodeFor(code, USERS.alice.id)).toBeNull();
  expect((await getMyInviteCodes(USERS.alice.id)).map((i) => i.code)).not.toContain(code);
});

test("revoking someone else's invite code does nothing to it", async () => {
  const minted = (await createInviteCodeFor(USERS.alice.id, 1, null)) as { code: string };

  // Scoped to the caller's own codes, so this matches nothing rather than
  // reporting whether the code exists.
  expect(await revokeInviteCodeFor(minted.code, USERS.bob.id)).toBeNull();
  expect((await getMyInviteCodes(USERS.alice.id)).map((i) => i.code)).toContain(minted.code);
});

test("listApiTokensFor marks the token making the request", async () => {
  const { row: first } = await createApiToken({ userId: USERS.alice.id, name: "one" });
  const { row: second } = await createApiToken({ userId: USERS.alice.id, name: "two" });

  const tokens = await listApiTokensFor(USERS.alice.id, first.id);
  const byId = new Map(tokens.map((t) => [t.id, t.current]));
  // Without this flag, "revoke token X" is a guess that might cut off the caller.
  expect(byId.get(first.id)).toBe(true);
  expect(byId.get(second.id)).toBe(false);
  // Secrets never come back.
  expect(Object.keys(tokens[0])).not.toContain("token_hash");
});

test("the admin surface is 404 for an ordinary user, not 403", async () => {
  // Bob is an ordinary account; the seed makes alice the admin.
  // A 403 would tell an ordinary token that an admin surface exists at all.
  expect(((await authorizeAdmin(USERS.bob.id)) as NextResponse).status).toBe(404);
  // And the admin gets through.
  expect(await authorizeAdmin(USERS.alice.id)).not.toBeInstanceOf(NextResponse);
});

test("adminDeleteBlock refuses a block in a private channel", async () => {
  const ch = await createChannel({
    title: "Private",
    access: "private",
    owned_by: USERS.bob.ownerId,
  });
  const block = await uploadTextColumn({
    created_by: USERS.bob.id,
    channel_id: ch.id,
    text: "private thing",
  });

  // Alice is the seed's admin; nothing is toggled here because she is the only
  // one, and setUserAdmin refuses to demote the last admin.
  {
    // Moderation covers what is public; being an admin is not a way into
    // someone's private collection.
    const result = await adminDeleteBlock(block.id, USERS.alice.id);
    expect((result as NextResponse).status).toBe(404);
    expect(await getColumn(block.id)).not.toBeNull();

    // The same admin can remove a public one.
    const open = await createChannel({
      title: "Public",
      access: "public",
      owned_by: USERS.bob.ownerId,
    });
    const visible = await uploadTextColumn({
      created_by: USERS.bob.id,
      channel_id: open.id,
      text: "public thing",
    });
    expect(await adminDeleteBlock(visible.id, USERS.alice.id)).toBeNull();
    expect(await getColumn(visible.id)).toBeNull();
  }
});

test("redactSettings hides mail credentials but says whether one is set", async () => {
  const redacted = redactSettings({
    max_invites_per_user: 5,
    max_columns_per_user: null,
    email: {
      provider: "resend",
      from: "hi@example.test",
      resend_api_key: "re_supersecret",
      smtp_host: "",
      smtp_port: null,
      smtp_user: "",
      smtp_pass: "",
    },
  });
  expect(redacted.email.resend_api_key).toBe("__set__");
  expect(redacted.email.smtp_pass).toBe("");
  // Everything that isn't a secret survives, so a client can still tell how the
  // instance is configured.
  expect(redacted.email.provider).toBe("resend");
  expect(redacted.email.from).toBe("hi@example.test");
  expect(redacted.max_invites_per_user).toBe(5);
});
