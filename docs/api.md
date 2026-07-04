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
anything you own, and write only what you own.

## Channels

### `GET /api/v1/channels`

List your channels. → `{ "channels": [...] }`

### `POST /api/v1/channels`

Create a channel (owned by you).

```json
{ "title": "My channel", "description": "optional", "private": false }
```

→ `201 { "channel": { ... } }`

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

## Blocks

### `GET /api/v1/channels/:id/blocks`

List a channel's blocks (public or owned). Optional `?limit=N`.
→ `{ "blocks": [...] }`

### `POST /api/v1/channels/:id/blocks`

Add a block to a channel you own. One of:

```json
{ "type": "text",  "text": "a note" }
{ "type": "url",   "url": "https://example.com" }
{ "type": "image", "image": "https://.../public-image.png" }
```

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
`description`, plus `text` / `url` / `image` for that block's type.
→ `{ "block": { ... } }`

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
