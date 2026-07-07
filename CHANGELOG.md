# Changelog

All notable changes to Colosseum are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). New entries
accumulate under **Unreleased** and are stamped with a version and date at
release.

## [Unreleased]

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
