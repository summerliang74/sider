CREATE EXTENSION IF NOT EXISTS "pg_trgm";--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.immutable_text_array_to_string(values_to_join text[])
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS 'SELECT array_to_string(values_to_join, '' '')';--> statement-breakpoint
ALTER TABLE "resources" ADD COLUMN "search_text" text GENERATED ALWAYS AS (
      coalesce("title", '') || ' ' ||
      coalesce("original_filename", '') || ' ' ||
      coalesce(public.immutable_text_array_to_string("tags"), '') || ' ' ||
      coalesce("description", '')
    ) STORED;--> statement-breakpoint
ALTER TABLE "resources" ADD COLUMN "search_vector" "tsvector" GENERATED ALWAYS AS (
      setweight(to_tsvector('simple', coalesce("title", '')), 'A') ||
      setweight(to_tsvector('simple', coalesce("original_filename", '')), 'A') ||
      setweight(to_tsvector('simple', coalesce(public.immutable_text_array_to_string("tags"), '')), 'B') ||
      setweight(to_tsvector('simple', coalesce("description", '')), 'C')
    ) STORED;--> statement-breakpoint
CREATE INDEX "resources_search_vector_idx" ON "resources" USING gin ("search_vector");--> statement-breakpoint
CREATE INDEX "resources_search_text_trgm_idx" ON "resources" USING gin ("search_text" gin_trgm_ops);
