# Changelog

All notable changes to Colosseum are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). New entries
accumulate under **Unreleased** and are stamped with a version and date at
release.

## [Unreleased]

## [1.8.2] - 2026-07-24

### Fixed

- Self-hosting: the `app` service in `compose.yaml` now passes through the
  documented S3/CDN vars (`S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY_ID`,
  `S3_SECRET_ACCESS_KEY`, `S3_ENDPOINT`, `CDN_URL`) and the runtime toggles
  (`DISABLE_SIGNUPS`, `API_RATE_LIMIT`, `API_RATE_WINDOW_MS`). Setting them in
  the compose `.env` previously had no effect because they never reached the
  container; unset, behavior is unchanged.

## [1.8.1] - 2026-07-22

### Fixed

- The Cmd/Ctrl+K command palette now highlights the first result again, so
  pressing Enter opens the top match immediately. With manual filtering the
  palette had stopped auto-selecting the first item, forcing an arrow-down
  before Enter would do anything.

## [1.8.0] - 2026-07-19

### Added

- YouTube blocks: paste a YouTube URL (watch, `youtu.be`, Shorts, or embed
  form) to add a video block. Grid cards show the video thumbnail; the modal and
  block page embed the live player. The block's title is set to the video's
  title. Nothing else is persisted — the embed renders from YouTube, so the
  block reflects the live video.
- Spotify blocks: paste an open.spotify.com URL (track, album, playlist, artist,
  episode, or show) to add a block. Grid cards show the cover art; the modal and
  block page embed the live Spotify player. The block's title and cover art come
  from Spotify; nothing else is persisted, so the block reflects the live item.
- Profile channel lists can now be sorted (recently added to, name, or column
  count) and filtered by access (public / open / private) and — on your own
  profile — whether you're a member of the channel.
- Outbound email, configured at runtime from the admin panel (Off / Resend /
  SMTP) with a "Send test" button. Password-reset mail routes through it, and
  transactional emails share a branded template.
- In-app notifications for comments, @mentions, channel connects, and channel
  membership, with a nav-bar bell and unread badge. Each type has an
  instant-save per-type email toggle in settings; notification delivery is
  best-effort and never blocks the action that triggered it.

## [1.7.5] - 2026-07-19

### Fixed

- Viewing a profile whose channel previews include a tweet no longer triggers a
  hydration error. Each channel card wrapped its previews in a `<Link>` (`<a>`),
  and a tweet preview renders its own avatar/header `<a>` inside — nesting them
  is invalid HTML. The card link is now a "stretched link" overlay that sits
  beside the previews rather than around them.

## [1.7.4] - 2026-07-19

### Fixed

- Opening a tweet block from the Explore feed no longer triggers a hydration
  error. The feed wrapped each block's card in a `<button>`, and a tweet card
  renders its own "Copy link" `<button>` inside — nesting them is invalid HTML.
  The feed trigger is now a `role="button"` element, matching the channel grid.

## [1.7.3] - 2026-07-19

### Fixed

- Tweet embed images (including the author's avatar) now load on
  proxied/HTTPS deployments. Their URLs were made absolute using the server's
  request origin, which behind a TLS-terminating proxy became `http://` and got
  blocked as mixed content; they are now resolved against the browser's origin.

## [1.7.2] - 2026-07-18

### Fixed

- Members of a private channel can now see the channel's images. Previously
  only the channel owner could load them — every image 404'd for members even
  though they could read the channel.

## [1.7.1] - 2026-07-18

### Fixed

- Channel-connection columns now open the block modal like any other column, so
  a connection can be deleted and its details viewed. Previously they navigated
  straight to the linked channel with no way to remove them, and stepping onto
  one via the side navigation showed an empty modal.

## [1.7.0] - 2026-07-18

### Added

- An admin area for managing the instance.
- Video files can now be uploaded as blocks and play inline.
- A column can be copied into another channel.
- Profile pages list the channels a person is a member of.
- Adding a member to a channel now searches users by name or handle.
- Members can see blocks from private channels they belong to in the Explore feed.
- Deleting a column now asks for confirmation first.
- The `/users` page shows an invite network graph of who invited whom.
- Blob storage is now pluggable, with an S3/CDN backend option alongside local disk.
- Tweets can be embedded as blocks that keep rendering even after the source tweet is deleted.

### Changed

- The REST API is now rate limited per token owner.

## [1.6.1] - 2026-07-16

### Fixed

- Untitled blocks (such as images) no longer shift the channel grid when
  hovered — the title line now reserves its height instead of collapsing.

## [1.6.0] - 2026-07-12

### Added

- Channels can be shared with invite links that let people join directly.
- A gradient "matrix" loading spinner now appears on the Explore feed and when
  loading more blocks on a channel.
- The block modal shows who created a block, and channel cards show column
  titles.
- Member avatars now appear on profile pages.

### Changed

- Grid and list views are now a single sliding toggle.
- The add-column flow is reachable from the top navigation.

### Fixed

- Channels with more than 50 blocks now paginate correctly instead of loading
  every block at once.
- Fixed a hydration error in the channel loading skeleton.

## [1.5.4] - 2026-07-11

### Fixed

- The mobile add-column drawer now opens to a consistent taller height, so the
  channel picker has room to scroll — previously it stayed stuck at the first
  step's shorter height.

## [1.5.3] - 2026-07-11

### Fixed

- The markdown text-block editor in the block modal now opens in Preview
  (rendered) mode and fills the panel height so it lines up with the sidebar.
- The command palette (Cmd/Ctrl+K) searches instantly on each keystroke instead
  of waiting for a short delay.
- The Explore feed now shows a block's title beneath its card when it has one.
- The mobile add-column drawer's channel picker opens taller and has a search
  box to filter channels when the list is long.

## [1.5.2] - 2026-07-11

### Fixed

- Image blocks created through the API (REST and MCP) are now fetched and stored
  like uploaded images — so they're compressed, thumbnailed, and served from
  Colosseum — instead of keeping a link to a third-party host that bypassed the
  grid's image compression.

## [1.5.1] - 2026-07-11

### Fixed

- Fixed a build failure that stopped the 1.5.0 release from deploying: markdown
  in text blocks is now sanitized with a pure-JS sanitizer that bundles for
  production, instead of one that pulled in an unbundleable dependency.

## [1.5.0] - 2026-07-11

### Added

- Text blocks are now Markdown: rendered when viewed, with a GitHub-style
  Write/Preview editor while editing. Dropping a `.md` file onto a channel
  creates one.
- PDF files are now a block type — drop or upload a PDF and it opens in an
  in-app viewer.
- The Explore feed now shows each member's avatar next to their handle.

### Changed

- Channel pages load with fewer, parallelized database queries.
- Profile pages fetch channel previews and counts in batched queries instead of
  one per channel.
- Channel and block search is backed by trigram and tag (GIN) indexes.

## [1.4.5] - 2026-07-10

### Fixed

- The block permalink side panel now has a bordered card around its metadata,
  matching the block modal.
- A URL block's preview is now centered in the permalink page's main column
  instead of hugging the left edge.

## [1.4.4] - 2026-07-10

### Added

- The block permalink page now shows the block's comments, matching the block
  modal.

### Fixed

- On a URL block's permalink page, the site link and its screenshot are now a
  single clickable preview that opens the link, sized to match the modal
  instead of stretching across the page.
- The block permalink page now fits the viewport like the modal — the page no
  longer scrolls; the screenshot and comments scroll within their own panels.

## [1.4.3] - 2026-07-10

### Fixed

- Text blocks in the block modal now size to their content instead of a fixed
  half-viewport-tall box with a large empty expanse below short text.

## [1.4.2] - 2026-07-10

### Fixed

- Signed-in users can now post comments on blocks opened from the Explore feed,
  not just read them.

## [1.4.1] - 2026-07-09

### Fixed

- The profile and Explore pages now scroll beneath the translucent nav bar like
  every other page, instead of within their own inner scroll area.

## [1.4.0] - 2026-07-09

### Added

- Comments: leave comments on individual blocks.
- Channel access modes — public, open (any signed-in user can add blocks), and
  private — with per-channel membership.
- An in-app developer documentation page.
- A UI motion and materials pass: press feedback when opening a block,
  translucent (frosted) nav bars, and support for the system reduced-motion,
  reduced-transparency, and increased-contrast preferences.

### Changed

- Channel pages load noticeably faster — the first page of blocks is
  server-rendered, image thumbnails are pre-generated at upload, per-request
  reads are deduplicated, prepared statements are enabled, and foreign-key
  columns are indexed.

## [1.3.3] - 2026-07-09

### Fixed

- Deleting a URL block — or a whole channel — now removes its cached page
  screenshot instead of retaining it forever, fixing a storage leak.
- A channel column no longer shows a linked channel's title, description, or
  item count after that channel is made private (unless you own it).

## [1.3.2] - 2026-07-08

### Fixed

- Copy that called a column a "block" (toasts, dialog titles, labels,
  placeholders) now consistently says "column".

## [1.3.1] - 2026-07-08

### Fixed

- Pasting a GIF copied from a web browser now keeps it animated, instead of
  saving a still frame.

## [1.3.0] - 2026-07-08

### Added

- Animated GIFs: GIF blocks now animate everywhere, including grid thumbnails
  (profile pictures already animated).
- A link to your own profile in the nav avatar menu.

### Changed

- Global search now spans every public profile, channel, and block across
  Colosseum, not just your own.

## [1.2.1] - 2026-07-08

### Fixed

- Signed-out visitors can now view the Explore page instead of being redirected
  to the landing page.
- URL blocks whose screenshot can't be captured now show the link's address
  instead of loading forever, and settle immediately rather than retrying for
  minutes.

## [1.2.0] - 2026-07-07

### Added

- An Explore page (`/explore`, where signed-in users land from `/`) with a feed
  of recent public activity — new blocks, channels, and members — from across
  the invite-connected network.
- A search box on the profile page to filter channels by title or description,
  in both grid and list views.
- Rich link previews (Open Graph / Twitter card) for shared public channel URLs,
  showing the channel name, description, and owner.
- Move a block to a different channel from the block modal, keeping its title,
  description, and tags.
- Add a public channel as a column inside one of your own channels (Are.na-style
  nesting); the column links straight to that channel.

### Changed

- Image column previews load faster: the grid serves generated thumbnails
  instead of the full-resolution image.

## [1.1.2] - 2026-07-07

### Fixed

- Buttons and other interactive controls now show a pointer cursor, so they read
  as clickable.

## [1.1.1] - 2026-07-06

### Fixed

- The changelog page no longer crashes in production: `CHANGELOG.md` is now
  shipped in the Docker image instead of being excluded by `.dockerignore`.

## [1.1.0] - 2026-07-05

### Added

- A command palette (Cmd/Ctrl+K) for quick navigation, search, theme switching,
  and logout.
- Installable iOS PWA: a web manifest, home-screen icons, and an offline service
  worker.
- A mobile bottom navigation bar with a "+" flow to add a block, then pick its
  channel.
- A list-view toggle for the channels on a profile, alongside the existing grid.
- Pasting images and capturing multiple files into blocks in one go.
- An in-app changelog page rendered from this file.
- Instant navigation: profile, channel, and block routes stream a loading shell
  on click.
- Accounts created from an invite link are attributed to the inviter.

### Changed

- Rebuilt the screenshot engine: faster and stealthier, with an og:image
  fallback.
- Channels are ordered by their most recently added block.
- The channel grid is two columns on mobile.

### Fixed

- Mobile drawers size with dvh, so the keyboard no longer shifts the layout in
  the installed PWA.
- The browser favicon shows the logo again instead of a stale icon.
- Removed a stray focus outline on the command palette input.
- The block modal keeps a constant size and the mobile bottom bar stays fixed.
- Long channel descriptions truncate on the profile card, and wrapped titles are
  centered.
- Dark-mode braille previews render correctly.
- iOS no longer zooms when focusing the block input, and pinch/double-tap zoom is
  disabled for an app-like feel.
- Larger image uploads no longer hit the server action body limit.
- puppeteer-extra is kept out of the webpack bundle, fixing a build failure.

## [1.0.3] - 2026-07-04

### Fixed

- Screenshot thumbnails are resized to a square instead of cropping a
  fixed-offset region, so previews are no longer clipped.

## [1.0.2] - 2026-07-04

### Changed

- Added prefixed, contextual server-side logging across the API surface.

### Fixed

- The screenshot poll loop no longer cancels its own retry timer.
- A page is still captured when `networkidle2` times out, instead of failing.

## [1.0.1] - 2026-07-03

### Added

- URL block previews are captured via the REST API.

### Fixed

- URL blocks poll for their preview instead of assuming it's missing.
- A permanently failed screenshot capture is now signalled instead of failing
  silently.

## [1.0.0] - 2026-07-03

Initial public release.

### Added

- Channels and blocks with a grid/list view toggle on the channel page.
- Tags on channels and blocks.
- A real logo mark for the nav, home, and favicon.
- Block modal with navigation, a growing description, and a hidden scrollbar.
- Public/private media layer with visibility tracked on the reference.
- Docker Compose packaging with a migrate-on-boot entrypoint.

### Changed

- Data access ported to Drizzle with authorization enforced in app code.
- Supabase Auth replaced with in-process Better Auth.
- Supabase Storage replaced with content-addressed local-disk storage.
