ALTER TABLE "notification" ALTER COLUMN "channel_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "notification" ADD COLUMN "group_id" uuid;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_group_id_owner_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."owner"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_one_subject" CHECK (("notification"."channel_id" is not null) <> ("notification"."group_id" is not null));