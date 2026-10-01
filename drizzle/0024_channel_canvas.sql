CREATE TABLE "channel_canvas" (
	"channel_id" bigint PRIMARY KEY NOT NULL,
	"doc" "bytea" NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "channel_canvas" ADD CONSTRAINT "channel_canvas_channel_id_channel_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channel"("id") ON DELETE cascade ON UPDATE no action;