-- gin_trgm_ops (used by the trigram indexes below) comes from pg_trgm; enable it
-- first. drizzle-kit doesn't emit extension DDL, so this line is added by hand.
CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
CREATE INDEX "channel_tags_gin_idx" ON "channel" USING gin ("tags");--> statement-breakpoint
CREATE INDEX "channel_title_trgm_idx" ON "channel" USING gin ("title" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "channel_description_trgm_idx" ON "channel" USING gin ("description" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "column_tags_gin_idx" ON "column" USING gin ("tags");--> statement-breakpoint
CREATE INDEX "column_title_trgm_idx" ON "column" USING gin ("title" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "column_description_trgm_idx" ON "column" USING gin ("description" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "column_text_trgm_idx" ON "column" USING gin ("text" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "column_url_trgm_idx" ON "column" USING gin ("url" gin_trgm_ops);