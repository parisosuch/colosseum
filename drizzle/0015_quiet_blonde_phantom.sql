ALTER TABLE "notification" ADD COLUMN "comment_id" bigint;--> statement-breakpoint
ALTER TABLE "notification" ADD COLUMN "email_sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_comment_id_comment_id_fk" FOREIGN KEY ("comment_id") REFERENCES "public"."comment"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- Connect notifications recorded the *linked* channel — the recipient's own —
-- so the link pointed back at the recipient instead of at the channel their
-- channel had been added to. They now record the host channel plus the channel
-- column created inside it, which is where the linked title is read from.
-- Rows whose column is gone keep the old shape; a null column_id on a connect
-- row is what marks it legacy, and it renders the old message and link.
--
-- The pair (actor, linked channel) doesn't identify a column on its own: the
-- same actor may have filed the same channel into several hosts. A connect
-- notification is written in the same request as its column, so the match is
-- bounded to a minute — otherwise a row whose own column was deleted would find
-- a sibling and be repointed to a host it was never about.
WITH match AS (
	SELECT DISTINCT ON (n."id")
		n."id" AS notification_id,
		c."id" AS column_id,
		c."channel_id" AS host_channel_id
	FROM "notification" n
	JOIN "column" c
		ON c."type" = 'channel'
		AND c."linked_channel_id" = n."channel_id"
		AND c."created_by" = n."actor_id"
		AND abs(extract(epoch FROM c."created_at" - n."created_at")) < 60
	WHERE n."type" = 'connect' AND n."column_id" IS NULL
	ORDER BY n."id", abs(extract(epoch FROM c."created_at" - n."created_at"))
)
UPDATE "notification" n
SET "column_id" = m.column_id, "channel_id" = m.host_channel_id
FROM match m
WHERE n."id" = m.notification_id;