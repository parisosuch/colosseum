CREATE TABLE "channel_canvas_version" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "channel_canvas_version_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"channel_id" bigint NOT NULL,
	"doc" "bytea" NOT NULL,
	"name" text,
	"created_by" uuid,
	"editors" uuid[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "channel_canvas_version" ADD CONSTRAINT "channel_canvas_version_channel_id_channel_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channel"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_canvas_version" ADD CONSTRAINT "channel_canvas_version_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "channel_canvas_version_channel_id_idx" ON "channel_canvas_version" USING btree ("channel_id","id");