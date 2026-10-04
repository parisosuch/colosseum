ALTER TABLE "channel_canvas" ADD COLUMN "has_elements" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- Canvases saved before the flag existed were all written by an edit; mark them
-- as having elements so the button stays until their next save sets it exactly.
UPDATE "channel_canvas" SET "has_elements" = true;
