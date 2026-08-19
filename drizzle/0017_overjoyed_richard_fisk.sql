CREATE INDEX "column_channel_id_title_idx" ON "column" USING btree ("channel_id","title");--> statement-breakpoint
CREATE INDEX "column_channel_id_title_desc_idx" ON "column" USING btree ("channel_id","title" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "column_created_by_idx" ON "column" USING btree ("created_by");