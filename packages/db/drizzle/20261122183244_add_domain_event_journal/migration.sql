CREATE TABLE "domain_event" (
	"id" text PRIMARY KEY,
	"global_seq" bigint GENERATED ALWAYS AS IDENTITY (sequence name "domain_event_global_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"tenant_id" text NOT NULL,
	"stream" text NOT NULL,
	"stream_seq" integer NOT NULL,
	"aggregate" text NOT NULL,
	"aggregate_id" text NOT NULL,
	"event_tag" text NOT NULL,
	"payload" jsonb NOT NULL,
	"command_id" text NOT NULL,
	"correlation_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "domain_event_global_seq_unique" ON "domain_event" ("global_seq");--> statement-breakpoint
CREATE UNIQUE INDEX "domain_event_stream_seq_unique" ON "domain_event" ("tenant_id","stream","stream_seq");--> statement-breakpoint
CREATE INDEX "domain_event_tenant_aggregate_idx" ON "domain_event" ("tenant_id","aggregate","aggregate_id");--> statement-breakpoint
CREATE INDEX "domain_event_tenant_tag_idx" ON "domain_event" ("tenant_id","event_tag","created_at");--> statement-breakpoint
ALTER TABLE "domain_event" ADD CONSTRAINT "domain_event_tenant_id_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id");