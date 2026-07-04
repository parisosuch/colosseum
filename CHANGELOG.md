# Changelog

All notable changes to Colosseum are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). New entries
accumulate under **Unreleased** and are stamped with a version and date at
release.

## [Unreleased]

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
