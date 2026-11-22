/**
 * Generates docs/architecture/domain-model.md directly from the live
 * `@alchemy.run/domain` `CoachingModel` definitions so architecture diagrams
 * can never drift from code (ADR 0023).
 *
 * Run: pnpm docs:diagrams
 * Check: tsx scripts/domain-diagrams.ts --check
 */
import * as Domain from '@alchemy.run/domain';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CoachingModel } from '../src/model/Coaching.model.ts';

const rejectionTag = (r: unknown): string => {
  if (typeof r === 'object' && r !== null) {
    if ('tag' in r && typeof r.tag === 'string') return r.tag;
    if ('_tag' in r && typeof r._tag === 'string') return r._tag;
  }
  if (typeof r === 'function' && 'tag' in r && typeof r.tag === 'string') return r.tag;
  return typeof r === 'function' ? r.name : String(r);
};

const normalizeMarkdown = (text: string) =>
  text
    .replaceAll(/[ \t]+/g, ' ')
    .replaceAll(/\| -+ /g, '| --- ')
    .trim();

const sanitize = (name: string) => name.replaceAll(/[^A-Za-z0-9_]/g, '_');

const sourceName = (src: { readonly aggregateName?: string; readonly viewName?: string }) =>
  src.aggregateName ?? src.viewName ?? 'Unknown';

const buildTopologyMermaid = () => {
  const { aggregates, views, policies, projections, queries = [] } = CoachingModel.definitions;
  const lines: Array<string> = [
    'flowchart LR',
    '  subgraph Aggregates["Core Aggregates (Consistency Boundaries)"]',
  ];
  for (const agg of aggregates) {
    lines.push(
      `    agg_${sanitize(agg.aggregateName)}["${agg.aggregateName}<br/>${agg.definition.commands.length} commands"]`,
    );
  }
  lines.push('  end', '', '  subgraph Policies["Standing Policies (Causal Rules)"]');
  for (const pol of policies) {
    lines.push(`    pol_${sanitize(pol.policyName)}["${pol.policyName}"]`);
  }
  lines.push('  end', '', '  subgraph Views["Live Read Views (Folded from Events)"]');
  for (const view of views) {
    lines.push(`    view_${sanitize(view.viewName)}["${view.viewName}"]`);
  }
  lines.push('  end', '', '  subgraph Projections["Projections & Queries"]');
  for (const proj of projections) {
    lines.push(`    proj_${sanitize(proj.projectionName)}["${proj.projectionName}"]`);
  }
  for (const q of queries) {
    lines.push(`    qry_${sanitize(q.queryName)}["${q.queryName}"]`);
  }
  lines.push('  end', '');

  // Aggregate -> Policy edges
  for (const pol of policies) {
    const froms = Array.isArray(pol.definition.from) ? pol.definition.from : [pol.definition.from];
    const eventTags = pol.definition.on.map((e) => e.tag).join(', ');
    for (const src of froms) {
      const sName = sourceName(src as { aggregateName?: string; viewName?: string });
      lines.push(`  agg_${sanitize(sName)} -->|"${eventTags}"| pol_${sanitize(pol.policyName)}`);
    }
  }

  // Aggregate -> View edges
  for (const view of views) {
    for (const src of view.definition.from) {
      const sName = sourceName(src as { aggregateName?: string; viewName?: string });
      lines.push(`  agg_${sanitize(sName)} --> view_${sanitize(view.viewName)}`);
    }
  }

  // Aggregate -> Projection edges
  for (const proj of projections) {
    for (const src of proj.definition.from) {
      const sName = sourceName(src as { aggregateName?: string; viewName?: string });
      lines.push(`  agg_${sanitize(sName)} -.-> proj_${sanitize(proj.projectionName)}`);
    }
  }

  // Projection -> Query edges
  for (const q of queries) {
    const waits = (q.definition as { waitsFor?: ReadonlyArray<{ projectionName?: string }> })
      .waitsFor;
    for (const w of waits ?? []) {
      if (w.projectionName) {
        lines.push(`  proj_${sanitize(w.projectionName)} --> qry_${sanitize(q.queryName)}`);
      }
    }
  }

  return lines.join('\n');
};

const buildAggregateSection = () => {
  const sections: Array<string> = ['## Aggregates, Commands & Events', ''];
  for (const agg of CoachingModel.definitions.aggregates) {
    sections.push(`### ${agg.aggregateName}`);
    const desc = agg.annotations?.description;
    if (desc) sections.push('', desc);
    sections.push('', '| Command | Emits Events | Typed Rejections |', '| --- | --- | --- |');
    for (const cmd of agg.definition.commands) {
      const events = cmd.events.map((e) => `\`${e.tag}\``).join(', ') || '—';
      const rejects = cmd.rejects.map((r) => `\`${rejectionTag(r)}\``).join(', ') || 'none';
      sections.push(`| \`${cmd.tag}\` | ${events} | ${rejects} |`);
    }
    sections.push('');
  }
  return sections.join('\n');
};

const buildConsumersSection = () => {
  const { views, policies, projections, queries = [] } = CoachingModel.definitions;
  const lines: Array<string> = [
    '## Views, Policies, Projections & Queries',
    '',
    '| Kind | Name | Sources / Triggers | Notes |',
    '| --- | --- | --- | --- |',
  ];
  for (const view of views) {
    const froms = view.definition.from
      .map((s) => `\`${sourceName(s as { aggregateName?: string; viewName?: string })}\``)
      .join(', ');
    lines.push(
      `| View | \`${view.viewName}\` | ${froms} | ${view.annotations?.description ?? ''} |`,
    );
  }
  for (const pol of policies) {
    const events = pol.definition.on.map((e) => `\`${e.tag}\``).join(', ');
    lines.push(
      `| Policy | \`${pol.policyName}\` | ${events} | ${pol.annotations?.description ?? ''} |`,
    );
  }
  for (const proj of projections) {
    lines.push(
      `| Projection | \`${proj.projectionName}\` | ${proj.definition.on.length} event types | ${proj.annotations?.description ?? ''} |`,
    );
  }
  for (const q of queries) {
    lines.push(`| Query | \`${q.queryName}\` | paged read | ${q.annotations?.description ?? ''} |`);
  }
  return lines.join('\n');
};

const verifyErrors = Domain.verify(CoachingModel);
if (verifyErrors.length > 0) {
  console.error('Domain.verify(CoachingModel) failed:', verifyErrors);
  process.exit(1);
}

const doc = [
  '# Domain Model (`@alchemy.run/domain`)',
  '',
  '> Generated directly from `packages/domain/src/model/Coaching.model.ts` by `pnpm docs:diagrams`. Do not edit by hand.',
  '> Verified statically by `Domain.verify(CoachingModel)` (0 definition errors) and behaviorally by `Story.make` concurrent interleaving specs + formal invariant proofs.',
  '',
  '## Bounded-Context Topology',
  '',
  '```mermaid',
  buildTopologyMermaid(),
  '```',
  '',
  buildAggregateSection().trimEnd(),
  '',
  buildConsumersSection(),
  '',
  '## Formal Verification Layers',
  '',
  '1. **Static Graph Verification (`Domain.verify`)**: verifies zero missing `keyOf` routes, zero un-emitted policy triggers, zero duplicate writers, and valid initial states (`packages/domain/src/model/Coaching.story.test.ts`, server invariant `I25`).',
  '2. **Concurrent Schedule Exploration (`Story.make`)**: replays multi-aggregate policies, projections, views, and stubbed external systems across concurrent interleavings in memory (`packages/domain/src/model/Coaching.story.test.ts`).',
  '3. **State-Space & Algebraic Proofs**: exhaustive BFS over all 8 XState lifecycles plus 250 randomized `SkillLedger` histories verifying credit conservation, idempotency, privacy safety, policy monotonicity, and zero-PII events (`packages/domain/src/verification/formal.test.ts`).',
  '',
].join('\n');

const out = fileURLToPath(new URL('../../../docs/architecture/domain-model.md', import.meta.url));
const checkOnly = process.argv.includes('--check');

if (checkOnly) {
  const current = existsSync(out) ? readFileSync(out, 'utf8') : '';
  if (normalizeMarkdown(current) !== normalizeMarkdown(doc)) {
    console.error(
      'docs/architecture/domain-model.md is out of date. Run `pnpm docs:diagrams` to regenerate.',
    );
    process.exit(1);
  }
  console.log('docs/architecture/domain-model.md is up to date.');
} else {
  writeFileSync(out, doc);
  console.log(`wrote ${out}`);
}
