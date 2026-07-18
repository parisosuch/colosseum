CREATE TABLE "tweet" (
	"id" text PRIMARY KEY NOT NULL,
	"data" jsonb NOT NULL,
	"media_urls" text[] DEFAULT '{}' NOT NULL,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL
);
