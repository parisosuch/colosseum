CREATE TABLE "group" (
	"owner_id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "group_member" (
	"group_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "group_member_group_id_user_id_pk" PRIMARY KEY("group_id","user_id"),
	CONSTRAINT "group_member_role_valid" CHECK ("group_member"."role" in ('owner', 'admin', 'member'))
);
--> statement-breakpoint
ALTER TABLE "group" ADD CONSTRAINT "group_owner_id_owner_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."owner"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group" ADD CONSTRAINT "group_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_member" ADD CONSTRAINT "group_member_group_id_group_owner_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."group"("owner_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_member" ADD CONSTRAINT "group_member_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "group_one_owner_idx" ON "group_member" USING btree ("group_id") WHERE "group_member"."role" = 'owner';--> statement-breakpoint
CREATE INDEX "group_member_user_id_idx" ON "group_member" USING btree ("user_id");