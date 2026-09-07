CREATE TABLE "owner" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"handle" text NOT NULL,
	"avatar_url" text,
	"about" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_id" uuid,
	CONSTRAINT "owner_handle_unique" UNIQUE("handle"),
	CONSTRAINT "owner_user_id_unique" UNIQUE("user_id"),
	CONSTRAINT "owner_user_id_iff_user_kind" CHECK (("owner"."kind" = 'user') = ("owner"."user_id" is not null))
);
--> statement-breakpoint
ALTER TABLE "owner" ADD CONSTRAINT "owner_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- One owner row per existing profile, carrying the handle/avatar/about that are
-- about to be dropped from user_profile. Every one is kind = 'user'; groups are
-- a later migration.
INSERT INTO "owner" ("kind", "handle", "avatar_url", "about", "created_at", "user_id")
SELECT 'user', "handle", "avatar_url", "about", "created_at", "user_id" FROM "user_profile";
--> statement-breakpoint
-- A user who signed up but never finished onboarding has no user_profile row and
-- therefore no handle, so no owner row can be built for them. They cannot reach
-- channel creation in the app, but an instance that got there another way would
-- otherwise fail three statements later on a NOT NULL with nothing to point at.
-- Say what is wrong instead.
--
-- The diagnosis goes out as a NOTICE before the EXCEPTION because drizzle-kit
-- prints NOTICEs but swallows the exception's message, showing only a non-zero
-- exit. Raising both is what puts the reason in front of whoever ran it. The
-- migration still aborts, and drizzle wraps the file in a transaction, so a
-- refusal leaves the database exactly as it was.
DO $$
DECLARE orphans bigint;
BEGIN
	SELECT count(*) INTO orphans
	FROM "channel" c LEFT JOIN "owner" o ON o."user_id" = c."owner_id"
	WHERE o."id" IS NULL;
	IF orphans > 0 THEN
		RAISE NOTICE 'colosseum 0021: cannot migrate. % channel row(s) are owned by a user with no user_profile, so they have no handle to become an owner. Give those users a handle, or delete the channels, then re-run.', orphans;
		RAISE EXCEPTION 'colosseum 0021: % channel row(s) have an owner with no handle (see the NOTICE above).', orphans;
	END IF;
END $$;
--> statement-breakpoint
-- Nullable, backfilled, then tightened — the column cannot be born NOT NULL on a
-- table that already has rows.
ALTER TABLE "channel" ADD COLUMN "owned_by" uuid;--> statement-breakpoint
UPDATE "channel" c SET "owned_by" = o."id" FROM "owner" o WHERE o."user_id" = c."owner_id";--> statement-breakpoint
ALTER TABLE "channel" ALTER COLUMN "owned_by" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "channel" ADD CONSTRAINT "channel_owned_by_owner_id_fk" FOREIGN KEY ("owned_by") REFERENCES "public"."owner"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "channel_owned_by_idx" ON "channel" USING btree ("owned_by");--> statement-breakpoint
ALTER TABLE "channel" DROP CONSTRAINT "channel_owner_id_user_id_fk";--> statement-breakpoint
DROP INDEX "channel_owner_id_idx";--> statement-breakpoint
ALTER TABLE "channel" DROP COLUMN "owner_id";--> statement-breakpoint
CREATE INDEX "owner_created_at_idx" ON "owner" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "owner_handle_trgm_idx" ON "owner" USING gin ("handle" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "owner_about_trgm_idx" ON "owner" USING gin ("about" gin_trgm_ops);--> statement-breakpoint
DROP INDEX "user_profile_created_at_idx";--> statement-breakpoint
DROP INDEX "user_profile_handle_trgm_idx";--> statement-breakpoint
DROP INDEX "user_profile_about_trgm_idx";--> statement-breakpoint
ALTER TABLE "user_profile" DROP CONSTRAINT "user_profile_handle_unique";--> statement-breakpoint
ALTER TABLE "user_profile" DROP COLUMN "created_at";--> statement-breakpoint
ALTER TABLE "user_profile" DROP COLUMN "handle";--> statement-breakpoint
ALTER TABLE "user_profile" DROP COLUMN "avatar_url";--> statement-breakpoint
ALTER TABLE "user_profile" DROP COLUMN "about";
