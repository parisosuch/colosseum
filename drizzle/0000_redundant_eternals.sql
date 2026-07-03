CREATE TABLE "api_token" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text,
	"token_prefix" text NOT NULL,
	"token_hash" text NOT NULL,
	"last_used_at" timestamp with time zone,
	CONSTRAINT "api_token_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "channel" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "channel_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"private" boolean DEFAULT false NOT NULL,
	"owner_id" uuid NOT NULL,
	"updated_at" timestamp with time zone,
	"tags" text[] DEFAULT '{}' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "column" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "column_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"type" text NOT NULL,
	"title" text,
	"description" text,
	"url" text,
	"text" text,
	"image" text,
	"created_by" uuid NOT NULL,
	"channel_id" bigint NOT NULL,
	"tags" text[] DEFAULT '{}' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invite_code" (
	"code" text PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"max_uses" integer DEFAULT 1 NOT NULL,
	"uses" integer DEFAULT 0 NOT NULL,
	"note" text
);
--> statement-breakpoint
CREATE TABLE "invite_redemption" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "invite_redemption_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"code" text NOT NULL,
	"user_id" uuid NOT NULL,
	"redeemed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invite_redemption_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "screenshot" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "screenshot_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"url" text NOT NULL,
	"image_url" text,
	"title" text,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL,
	"description" text,
	CONSTRAINT "screenshot_url_unique" UNIQUE("url")
);
--> statement-breakpoint
CREATE TABLE "user_profile" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"handle" text NOT NULL,
	"avatar_url" text,
	"about" text,
	CONSTRAINT "user_profile_handle_unique" UNIQUE("handle")
);
--> statement-breakpoint
ALTER TABLE "column" ADD CONSTRAINT "column_channel_id_channel_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channel"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invite_redemption" ADD CONSTRAINT "invite_redemption_code_invite_code_code_fk" FOREIGN KEY ("code") REFERENCES "public"."invite_code"("code") ON DELETE cascade ON UPDATE no action;