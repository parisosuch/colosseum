CREATE TABLE "canvas_thread" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "canvas_thread_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"channel_id" bigint NOT NULL,
	"element_id" text,
	"last_element_id" text,
	"offset_x" real,
	"offset_y" real,
	"x" double precision NOT NULL,
	"y" double precision NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "comment" ALTER COLUMN "column_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "comment" ADD COLUMN "thread_id" bigint;--> statement-breakpoint
ALTER TABLE "notification" ADD COLUMN "thread_id" bigint;--> statement-breakpoint
ALTER TABLE "canvas_thread" ADD CONSTRAINT "canvas_thread_channel_id_channel_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channel"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "canvas_thread" ADD CONSTRAINT "canvas_thread_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "canvas_thread_channel_id_created_at_idx" ON "canvas_thread" USING btree ("channel_id","created_at");--> statement-breakpoint
ALTER TABLE "comment" ADD CONSTRAINT "comment_thread_id_canvas_thread_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."canvas_thread"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_thread_id_canvas_thread_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."canvas_thread"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "comment_thread_id_created_at_idx" ON "comment" USING btree ("thread_id","created_at");--> statement-breakpoint
ALTER TABLE "comment" ADD CONSTRAINT "comment_one_parent" CHECK (("comment"."column_id" is not null) <> ("comment"."thread_id" is not null));