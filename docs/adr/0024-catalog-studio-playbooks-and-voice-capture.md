# ADR 0024: Skill catalog studio, level-up playbooks, and on-device voice capture

- Status: Accepted
- Date: 2026-11-22

## Context

Three enterprise capabilities were prioritized for the first release:

1. **Skill discovery & authoring.** Advisors need to discover which skills are
   **core** vs. **common**, spot firm-wide gaps and rare skill pairings, and
   follow concrete level-up resources. Program teams and tenant admins need to
   author new skills, publish updated versions, and curate playbooks without
   requiring a database reseed or code deploy.
2. **Low-friction observation capture.** Busy leaders and coaches often capture
   observations right after client meetings. Typing structured "What I saw" and
   "Try next time" notes on a laptop or phone adds friction, yet shipping raw
   audio containing potential client details to a third-party speech API would
   violate our strict client-PII boundary (ADR 0012).

## Decision

1. **Core/common tiers, tags, and firm signals in `packages/domain/src/scoring/catalog-insights.ts`.**
   Every skill is classified as `core` or `common` with structured tags. Pure
   domain computations surface lacking skills, popular skills, and rare skill
   combinations for visual exploration (Constellation & Landscape views) and
   development-plan selection, with zero per-person leaderboards or rankings.
2. **Skill Catalog Authoring Studio & immutable versions (`SkillCatalog` aggregate).**
   Tenant admins author new skills, publish new immutable `skill_version` rows
   (preserving indicator `lineage_key` continuity), and attach or remove
   level-up playbook resources (`skill.resources` JSONB) per skill level. Every
   mutation is audited and journaled in `domain_event` (`SkillPublished`,
   `SkillVersionPublished`, `PlaybookResourceAttached`,
   `PlaybookResourceRemoved`).
3. **On-device Voice-to-Structured-Note capture.**
   Voice dictation in observation capture uses the browser's local
   `SpeechRecognition` API (`apps/web/src/lib/voice-capture.ts` and
   `apps/web/src/components/voice-note-bar.tsx`) plus pure client-side cue
   splitting ("next time", "try next", "work on") into the `narrativeSaw` and
   `narrativeNext` fields.
   - No audio is recorded, persisted, or transmitted to our server or any
     third-party AI service.
   - Spoken text lands in the standard editable text fields and passes through
     the exact same local PII screen (`screenLocally`) and human review before
     signing (ADR 0008, ADR 0012).

## Alternatives considered

- **Server-side or third-party cloud speech-to-text (Whisper / Gemini audio).**
  Rejected for v1 because sending raw post-meeting voice recordings off-device
  dramatically expands the client-PII compliance surface (Reg S-P / FINRA 4511).
- **Separate relational `skill_resource` table.** Deferred in favor of typed
  `skill.resources` JSONB validated by Effect `Schema` because playbook links
  have no foreign-key integrity targets and always load with the skill detail.

## Consequences

- Tenant admins can evolve their skill taxonomy and playbooks self-service while
  keeping historical observations pinned to immutable `skill_version` records.
- Voice capture degrades gracefully (hidden when `SpeechRecognition` is
  unavailable in a browser) and creates zero new server or vendor privacy risk.
