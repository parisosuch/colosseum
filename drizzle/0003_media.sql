CREATE TABLE "media" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"owner_id" uuid NOT NULL,
	"blob_sha256" text NOT NULL,
	"visibility" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "media" ADD CONSTRAINT "media_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media" ADD CONSTRAINT "media_blob_sha256_blobs_sha256_fk" FOREIGN KEY ("blob_sha256") REFERENCES "public"."blobs"("sha256") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- Existing rows still hold `/api/blob/<sha>` URLs from before the media layer.
-- Give each reference its own media row (visibility from the owning channel
-- for image blocks; public for avatars and screenshots) and rewrite the URL to
-- `/api/media/<id>`. The by-hash route is gone, so unrewritten URLs would 404.
WITH src AS (
	SELECT c.id AS col_id,
		gen_random_uuid() AS media_id,
		c.created_by AS owner_id,
		b.sha256 AS sha,
		CASE WHEN ch.private THEN 'private' ELSE 'public' END AS visibility
	FROM "column" c
	JOIN "channel" ch ON ch.id = c.channel_id
	JOIN "blobs" b ON b.sha256 = substring(c.image from '^/api/blob/([0-9a-f]{64})$')
	WHERE c.image LIKE '/api/blob/%'
),
ins AS (
	INSERT INTO "media" ("id", "owner_id", "blob_sha256", "visibility")
	SELECT media_id, owner_id, sha, visibility FROM src
)
UPDATE "column" c
SET "image" = '/api/media/' || src.media_id
FROM src
WHERE c.id = src.col_id;--> statement-breakpoint
WITH src AS (
	SELECT p.user_id,
		gen_random_uuid() AS media_id,
		b.sha256 AS sha
	FROM "user_profile" p
	JOIN "blobs" b ON b.sha256 = substring(p.avatar_url from '^/api/blob/([0-9a-f]{64})$')
	WHERE p.avatar_url LIKE '/api/blob/%'
),
ins AS (
	INSERT INTO "media" ("id", "owner_id", "blob_sha256", "visibility")
	SELECT media_id, user_id, sha, 'public' FROM src
)
UPDATE "user_profile" p
SET "avatar_url" = '/api/media/' || src.media_id
FROM src
WHERE p.user_id = src.user_id;--> statement-breakpoint
WITH src AS (
	SELECT s.id AS shot_id,
		gen_random_uuid() AS media_id,
		b.created_by AS owner_id,
		b.sha256 AS sha
	FROM "screenshot" s
	JOIN "blobs" b ON b.sha256 = substring(s.image_url from '^/api/blob/([0-9a-f]{64})$')
	WHERE s.image_url LIKE '/api/blob/%'
),
ins AS (
	INSERT INTO "media" ("id", "owner_id", "blob_sha256", "visibility")
	SELECT media_id, owner_id, sha, 'public' FROM src
)
UPDATE "screenshot" s
SET "image_url" = '/api/media/' || src.media_id
FROM src
WHERE s.id = src.shot_id;
