# Single-stage image: the runtime needs drizzle-kit (migrate-on-boot) and the
# full install already contains it, so a multi-stage prune buys little here.
# ponytail: single stage, ~larger image; split build/runtime stages if pull
# size ever matters.
FROM oven/bun:1.4

# Debian's Chromium for the screenshot capture (puppeteer drives it via
# PUPPETEER_EXECUTABLE_PATH and skips downloading its own copy below), plus
# ffmpeg, which decodes the poster frame a video block's card renders instead of
# the video itself (lib/colosseum/video-frame.ts). ffmpeg is optional at runtime
# — without it video blocks still work, their cards just show a placeholder.
RUN apt-get update && \
    apt-get install -y --no-install-recommends chromium ffmpeg fonts-liberation ca-certificates && \
    rm -rf /var/lib/apt/lists/*
ENV PUPPETEER_SKIP_DOWNLOAD=1 \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY . .

# `next build` imports server modules whose top level requires DATABASE_URL to
# be set; no connection is made until a query runs, so a placeholder is enough.
ENV NEXT_TELEMETRY_DISABLED=1
RUN DATABASE_URL=postgres://build:build@localhost:5432/build bun run build

ENV NODE_ENV=production
EXPOSE 3000

# Migrates, then serves — the server never starts on an unmigrated database.
ENTRYPOINT ["./entrypoint.sh"]
