CREATE TABLE "blobs" (
	"sha256" text PRIMARY KEY NOT NULL,
	"mime" text NOT NULL,
	"size" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL
);
