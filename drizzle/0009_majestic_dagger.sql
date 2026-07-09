CREATE INDEX "column_url_idx" ON "column" USING btree ("url");--> statement-breakpoint
CREATE INDEX "column_linked_channel_id_idx" ON "column" USING btree ("linked_channel_id");