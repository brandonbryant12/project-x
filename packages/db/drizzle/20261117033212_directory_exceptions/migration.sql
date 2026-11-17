CREATE TABLE "directory_exception" (
	"id" text PRIMARY KEY,
	"tenant_id" text NOT NULL,
	"kind" text NOT NULL,
	"person_id" text,
	"email" text,
	"dedupe_key" text NOT NULL,
	"data" jsonb DEFAULT '{}' NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"detected_on" date NOT NULL,
	"acknowledged_by_id" text,
	"acknowledged_at" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "directory_exception_kind_check" CHECK ("kind" in ('coach_reports_to_coach', 'manager_not_found', 'cycle', 'self_manager', 'duplicate_email', 'manager_departed', 'invalid_row', 'self_departure')),
	CONSTRAINT "directory_exception_status_check" CHECK ("status" in ('open', 'acknowledged', 'resolved')),
	CONSTRAINT "directory_exception_acknowledged_shape" CHECK (("acknowledged_by_id" is null) = ("acknowledged_at" is null)),
	CONSTRAINT "directory_exception_resolved_shape" CHECK (("status" = 'resolved') = ("resolved_at" is not null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "directory_exception_live_unique" ON "directory_exception" ("tenant_id","dedupe_key") WHERE "status" in ('open', 'acknowledged');--> statement-breakpoint
CREATE INDEX "directory_exception_tenant_status_idx" ON "directory_exception" ("tenant_id","status","created_at");--> statement-breakpoint
ALTER TABLE "directory_exception" ADD CONSTRAINT "directory_exception_tenant_id_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id");--> statement-breakpoint
ALTER TABLE "directory_exception" ADD CONSTRAINT "directory_exception_person_fk" FOREIGN KEY ("tenant_id","person_id") REFERENCES "person"("tenant_id","id");--> statement-breakpoint
ALTER TABLE "directory_exception" ADD CONSTRAINT "directory_exception_acknowledged_by_fk" FOREIGN KEY ("tenant_id","acknowledged_by_id") REFERENCES "person"("tenant_id","id");