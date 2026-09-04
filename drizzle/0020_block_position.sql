ALTER TABLE "column" ADD COLUMN "position" text;--> statement-breakpoint
CREATE INDEX "column_channel_id_position_idx" ON "column" USING btree ("channel_id","position");