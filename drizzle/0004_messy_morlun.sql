CREATE INDEX "channel_created_at_idx" ON "channel" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "column_created_at_idx" ON "column" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "user_profile_created_at_idx" ON "user_profile" USING btree ("created_at");