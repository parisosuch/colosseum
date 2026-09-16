# Colosseum REST API

A small REST API to CRUD your channels and blocks programmatically. All
endpoints live under `/api/v1`.

## Authentication

Create a token under **Settings → API tokens**. The plaintext is shown once at
creation — store it somewhere safe; only its hash is kept server-side.

Send it as a bearer token on every request:

```
Authorization: Bearer clsm_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

- `401` — missing or invalid token.
- `403` — valid token, but you don't own the resource you're trying to modify.
- `404` — the resource doesn't exist, or it's a private channel you can't see.

A token grants the same access its owner has: it can read public channels and
anything you own, and write only what you own. "You" includes the groups you
belong to — a group's channels are yours to read, and yours to write if your
role there allows it.

## Channels

### `GET /api/v1/channels`

List your channels, including those owned by groups you're in.
→ `{ "channels": [...] }`

Each channel carries the `handle` it lives under, which for a group's channel
is the group's rather than yours — so its page is `/{handle}/{id}`.

### `POST /api/v1/channels`

Create a channel. Owned by you unless `owner` names a group you manage.

```json
{ "title": "My channel", "description": "optional", "private": false }
```

| Field         |                                                                      |
| :------------ | :------------------------------------------------------------------- |
| `title`       | Required.                                                            |
| `description` | Optional.                                                            |
| `access`      | `public`, `open` or `private`. Defaults to `public`.                 |
| `owner`       | Optional group handle (see `GET /api/v1/groups`). Omit for your own. |

→ `201 { "channel": { ... } }`

`403` if `owner` names a group you're only a member of: adding blocks to a
group's channels is what membership buys, while starting new ones takes the
owner or admin role.

### `GET /api/v1/channels/:id`

Fetch a channel (public or owned). → `{ "channel": { ... } }`

### `PATCH /api/v1/channels/:id`

Update a channel you own. Partial — omitted fields are unchanged.

```json
{ "title": "Renamed", "private": true }
```

→ `{ "channel": { ... } }`

### `DELETE /api/v1/channels/:id`

Delete a channel you own (its blocks cascade). → `{ "success": true }`

### `POST /api/v1/channels/:id/nest`

Add another channel as a block inside this one — the Are.na-style link. `:id`
is the host; the body names the channel being linked.

```json
{ "channelId": 34 }
```

→ `201 { "block": { ..., "type": "channel", "linked_channel_id": 34 } }`

The one block type `POST /channels/:id/blocks` cannot produce.

You must own the host, which is stricter than adding a block to it: nesting
puts a permanent link to someone's collection in your channel and notifies its
owner. The linked channel only has to be visible, and a private one is a `404`
rather than a `403`, so this never confirms one exists. A channel cannot be
nested in itself (`400`). Charged to your block quota.

### `GET /api/v1/channels/:id/members`

The channel's roster. → `{ "members": [...] }`

Readable by anyone who can see the channel — the channel page shows the same
list.

### `POST /api/v1/channels/:id/members`

Add someone by handle. Owner only.

```json
{ "handle": "alice" }
```

→ `201 { "member": { ... } }`

This is how a private channel gets shared: a channel an API client creates as
private is otherwise a dead end until a person opens the app. The person added
is notified, once — re-adding an existing member changes nothing and sends no
second notice. `400` for a handle nobody has, or the channel's own owner.

### `DELETE /api/v1/channels/:id/members/:handle`

Take someone off the roster. Owner only. → `{ "success": true }`

### `DELETE /api/v1/channels/:id/members/me`

Give up your own membership of a channel someone else owns. → `204`, no body.

Scoped to `me`. Removing _other_ people is roster management and stays in the
app, where it is confirmed.

`409` if you manage the channel — ownership is not a membership row, so there
would be nothing to remove, and the answer is to delete the channel or hand it
on. `409` if you were never a member. `404` if you cannot read the channel at
all, so this never confirms that someone else's private channel exists.

## Account

### `GET /api/v1/me`

Who the token belongs to, and what it may still add.

→ `{ "me": { "handle", "about", "avatar_url", "created_at", "blocks": { "used", "limit" } } }`

`blocks` is the account's block allowance: `used` against the `limit` that
`POST /api/v1/channels/:id/blocks` refuses on once reached. A `null` limit is
unlimited — admins, and instances that set no cap. Reading it is how a client
adding a batch can tell a quota refusal apart from a transient failure before
it hits one.

Every other endpoint is addressed by channel id, or by a group handle from
`GET /api/v1/groups`, so without this a client can name every group it belongs
to but not its own account.

Identity only. The user id and owner id are not returned: no endpoint accepts
either, and the two are easy to mistake for one another.

## Resolving links

### `GET /api/v1/resolve`

Turn a Colosseum link, or a bare handle, into the ids everything else takes.
`?q=` accepts a full URL, a `host/path`, a `/path`, or just a handle.

→ `{ "owner": { "handle", "kind", "about" }, "channel": { ... }, "block": { ... } }`

`channel` and `block` appear only when the link named them. A handle is a person
or a group — `kind` says which.

Every other endpoint takes a numeric id, and `GET /channels` lists only your
own, so without this a link — which is how a channel actually gets shared — was
unusable.

The channel is authorized like any other read, so a private one you can't see is
a `404` whether or not it exists. A block that isn't in the channel the link
named is a `404` too.

### `GET /api/v1/owners/:handle/channels`

The channels under a handle, whether or not you own it.

→ `{ "owner": { "handle", "kind", "about" }, "channels": [...] }`

Scoped through the viewer exactly as the profile page is: public and open
channels, plus any private ones you can already reach. `GET /channels` stays
what it is — yours — and this is how anyone else's become reachable.

## Search

### `GET /api/v1/search`

Find people, channels and blocks matching `?q=`. Optional `?limit=N` per kind,
1–50, default 10.

→ `{ "profiles": [...], "channels": [...], "blocks": [...] }`

Results are scoped to what the token can see: public things, plus channels you
own or belong to. Nothing private leaks.

This is the way to find a block. Listing every channel and matching client-side
pulls most of a collection across the wire to locate one link. To read a whole
channel rather than find something in it, page
`GET /api/v1/channels/:id/blocks` instead — search is capped, and deliberately.

### `PATCH /api/v1/me`

Edit your own profile.

```json
{ "handle": "alice", "about": "collects type specimens", "avatar": "https://.../me.png" }
```

→ `{ "me": { ... } }`

The avatar is a URL the server fetches, not bytes — the same shape an image
block takes. `409` if the handle is taken, `400` if it isn't a valid handle,
`422` if the avatar can't be fetched. Replacing an avatar drops the old one's
media.

Creating a profile is deliberately absent: a token can only be minted from the
settings page, which redirects to onboarding when there is no profile, so no
API caller can hold a token and lack one.

### `GET /api/v1/handles/:handle`

Whether a handle is free. → `{ "available": true }`

`{ "available": null, "reason": ... }` means it isn't a valid handle, which is a
different answer from taken. People and groups share one namespace, so a handle
a group holds is not available.

## Groups

A group is a handle several people share. The channels made in it belong to the
group rather than to any one account, and each member's role says what they may
do with them: `member` adds blocks, `admin` also manages the channels and the
roster, and the single `owner` can hand the group on or delete it.

### `GET /api/v1/groups`

List the groups you're in. → `{ "groups": [{ "handle", "name", "about", "role", "created_at" }] }`

This is how a client learns which handles it may pass as `owner` when creating
a channel; `role` says which of them will be accepted.

### `POST /api/v1/groups`

Start a group. → `201 { "group": { ... } }`

```json
{ "handle": "studio", "name": "Studio" }
```

You become its owner. The handle comes from the same pool people's handles do,
so `409` if it's taken — check `GET /api/v1/handles/:handle` first.

### `PATCH /api/v1/groups/:handle`

Rename a group or change its blurb. Owner or admin. → `{ "group": { ... } }`

The handle itself isn't editable here: it's the group's address, and every link
to its channels runs through it.

### `DELETE /api/v1/groups/:handle`

Delete a group. Owner only. → `{ "success": true }`

**Its channels go with it**, and their blocks — the channels belong to the
group, so nothing is left holding them. That cascade is why this is the owner's
alone rather than an admin's.

### `GET /api/v1/groups/:handle/members`

The roster, with each member's role. Any member may read it.
→ `{ "members": [...] }`

### `POST /api/v1/groups/:handle/members`

Add someone. Owner or admin. → `201 { "member": { ... } }`

```json
{ "handle": "alice", "role": "member" }
```

`role` is `member` or `admin`; `owner` isn't assignable, since a group has
exactly one and it changes hands through the transfer route. They're notified,
once — a role change on someone already in the group sends nothing.

### `PATCH /api/v1/groups/:handle/members/:member`

Change a member's role. Owner or admin. → `{ "success": true }`

The owner's role can't be set here, which is what stops a group being left with
nobody able to administer it.

### `DELETE /api/v1/groups/:handle/members/:member`

Remove someone, or leave by naming your own handle. Removing anyone else takes
owner or admin. The owner can't be removed — they transfer or delete.

### `POST /api/v1/groups/:handle/transfer`

Hand the group to another member. Owner only. `{ "to": "alice" }`

### `POST /api/v1/channels/:id/transfer`

Move a channel to another owner — a group you administer, or back to yourself.
`{ "to": "studio" }` → `{ "channel": { ... } }`

You must own the channel now and be able to manage where it's going.
**Ownership is what grants access to a private channel, so this changes who can
read it.** The channel's own member roster is deliberately left as it is.

## Blocks

### `GET /api/v1/channels/:id/blocks`

List a channel's blocks (public or owned), newest first.
Optional `?limit=N&offset=N`. → `{ "blocks": [...], "total": 128 }`

`total` is the channel's whole block count, not the page's, so a client can page
to the end instead of guessing: request `offset=0&limit=50`, then `offset=50`,
until `offset + blocks.length` reaches `total`. Without an offset the newest
`limit` blocks are a sample of a large channel rather than a listing of it.

### `POST /api/v1/channels/:id/blocks`

Add a block to a channel you own. One of:

```json
{ "type": "text",  "text": "a note" }
{ "type": "url",   "url": "https://example.com", "detect": true }
{ "type": "image", "image": "https://.../public-image.png" }
```

Optional `tags` on any of them: `{ "type": "url", "url": "...", "tags": ["reading", "css"] }`.

A url is ingested as what it points at: a tweet, a YouTube video or channel, a
Spotify item, a GitHub repo or account, an Instagram post, or a direct image
each become that kind of block, with their details fetched and stored — the
same as a link pasted into the web app. Anything else stays a plain link, and
only a plain link gets a screenshot.

**So the block that comes back is often not `type: "url"`.** Read the returned
`type` rather than assuming. Pass `"detect": false` to force a plain link block
— worth it if you want the screenshot card, or if the link's host is slow and
you'd rather not wait on the lookup.

When a lookup fails — a deleted tweet, a rate-limited GitHub, an unreachable
host — the block falls back to a plain link rather than failing the request.

→ `201 { "block": { ..., "preview": null } }`

> A url block's preview screenshot captures in the background — the create call
> returns immediately with `preview: null` and doesn't block on it. Poll
> `GET /api/v1/blocks/:id` and watch `preview`:
>
> - `null` — still capturing (or not triggered yet). Keep polling.
> - `{ "failed": true }` — capture ran and failed permanently (dead site, DNS
>   failure, etc). Stop polling.
> - `{ "image_url": "...", "title": "..." }` — captured successfully.
>
> Skipped entirely if another block already has a cached preview for the same
> URL. `text` and `image` blocks always have `preview: null`.

### `GET /api/v1/blocks/:id`

Fetch a block (visible if its channel is public or owned).
→ `{ "block": { ... } }`

### `PATCH /api/v1/blocks/:id`

Update a block in a channel you own. Editable fields by type: `title`,
`description`, plus `text` / `url` / `image` for that block's type, and `tags`
on any type. → `{ "block": { ... } }`

`tags` replaces the whole list rather than adding to it, so send the tags you
want to keep; `[]` clears them.

#### Tags

Tags are alphanumeric with dashes. Spaces become dashes, anything else is
dropped, and duplicates are removed — `["design systems", "#css!"]` is stored as
`["design-systems", "css"]`. The board filters tags on an exact match, so a tag
stored in any other shape would match nothing and could not be removed from the
editor either; the same rule runs in both places (`lib/tags.ts`).

### `POST /api/v1/blocks/:id/copy`

Put a copy of a block in another channel, leaving the original where it is.

```json
{ "channelId": 12 }
```

→ `201 { "block": { ... } }`

Asymmetric with a move, and looser: copying only _reads_ the source, so any
block in a channel you can see may be copied, while the target must be one you
can contribute to. A move needs ownership of both, because it takes the block
away from where it was.

The copy is a new block with its own id and, for an uploaded image or PDF, its
own media reference minted under the target channel's privacy — so deleting
either block leaves the other whole, and a copy into a private channel doesn't
keep pointing at public media. A copy is charged to your block quota.

### `PUT /api/v1/blocks/:id/position`

Place a block in its channel's manual order. → `{ "block": { ... } }`

```json
{ "after": 41 }
{ "after": null }
```

`after` is the id of the block this one should sit behind, or `null` to put it
first. Both blocks must be in the same channel; an anchor from elsewhere is a
`404`, since a position key only orders a block against its own channel's.

Required, not optional — a missing `after` is a `400` rather than being read as
`null`, so forgetting the field can't silently send a block to the top.

Channel owners only, which is stricter than `PATCH /api/v1/blocks/:id`: a
contributor may edit the block they added, but a reorder rearranges everyone's.
That is why it is its own endpoint rather than a field on the PATCH.

### `DELETE /api/v1/blocks/:id`

Delete a block in a channel you own. → `{ "success": true }`

## Notifications

### `GET /api/v1/notifications`

What has happened to your account. Optional `?before=` (the `at` of the last one
you saw) and `?unread=true`.

→ `{ "notifications": [...], "unread": 3, "page_size": 30 }`

`unread` is the whole count, not the page's, so a client can show a badge
without paging to the end. Reading the list marks nothing.

### `POST /api/v1/notifications/:id/read`

Mark one read. → `{ "success": true }`

Scoped to you as the recipient, so someone else's id matches nothing and comes
back successful rather than reporting whether it exists.

### `POST /api/v1/notifications/read-all`

Mark every unread one read. → `{ "success": true }`

### `GET` / `PATCH /api/v1/notifications/preferences`

Which kinds of notification are also emailed.

```json
{ "type": "comment", "enabled": false }
```

→ `{ "email_notifications": { ... } }`

One kind per call: the preferences are a single JSON column, so a partial write
of the whole object would drop whichever keys were left out. The in-app
notification arrives either way — this only decides whether it is also mailed.

## Comments

### `GET /api/v1/blocks/:id/comments`

What has been said about a block. → `{ "comments": [...] }`

Visible to anyone who can read the block.

### `POST /api/v1/blocks/:id/comments`

Leave a comment. → `201 { "comment": { ... } }`

```json
{ "body": "the second half of this is the good part" }
```

Any reader may comment, not only the channel's owner. `@handle` in the text
notifies that person — but only if they can read the channel, so a mention can
never hand a private channel's contents to someone outside it. Empty or
over-length is a `400`.

### `DELETE /api/v1/comments/:id`

Remove a comment. → `{ "success": true }`

Its author always may; otherwise the block's channel owner may moderate it.
Addressed by comment id, which is what the list hands back.

## Example

```bash
TOKEN="clsm_..."
BASE="https://your-host/api/v1"

# Create a channel
cid=$(curl -s -X POST "$BASE/channels" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"title":"Reading list","private":false}' | jq '.channel.id')

# Add a link block
curl -s -X POST "$BASE/channels/$cid/blocks" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"type":"url","url":"https://are.na"}'

# List the channel's blocks
curl -s "$BASE/channels/$cid/blocks" -H "Authorization: Bearer $TOKEN"
```
