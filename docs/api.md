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

## Groups

A group is a handle several people share. The channels made in it belong to the
group rather than to any one account, and each member's role says what they may
do with them: `member` adds blocks, `admin` also manages the channels and the
roster, and the single `owner` can hand the group on or delete it.

### `GET /api/v1/groups`

List the groups you're in. → `{ "groups": [{ "handle", "name", "about", "role", "created_at" }] }`

This is how a client learns which handles it may pass as `owner` when creating
a channel; `role` says which of them will be accepted.

Read-only. Creating a group claims a handle in the same namespace people draw
from, and changing a roster decides who can read private channels — both stay in
the app, where they are confirmed.

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
{ "type": "url",   "url": "https://example.com" }
{ "type": "image", "image": "https://.../public-image.png" }
```

Optional `tags` on any of them: `{ "type": "url", "url": "...", "tags": ["reading", "css"] }`.

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
