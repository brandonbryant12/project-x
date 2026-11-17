/**
 * Generates docs/architecture/lifecycles.md from the XState machines, so the
 * diagrams can never drift from the code (ADR 0005). Run: pnpm docs:lifecycles
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ALL_LIFECYCLES } from '../src/lifecycles/index.ts';

interface StateConfig {
  readonly type?: string;
  readonly on?: Readonly<
    Record<string, string | { readonly target?: string; readonly guard?: string }>
  >;
}

const HUMAN_ONLY = new Set([
  'SIGN',
  'ACCEPT',
  'DECLINE',
  'AGREE',
  'ENDORSE',
  'RETURN',
  'VOID',
  'UPHOLD',
  'RELEASE',
  'RESOLVE',
  'ACKNOWLEDGE',
  'REQUEST_REVIEW',
  'PUBLISH',
  'WITHDRAW',
  'RESUBMIT',
  'COMPLETE',
  'CANCEL',
]);
const SYSTEM = new Set(['EXPIRE', 'CLEAR', 'HOLD', 'ESCALATE', 'SKIP', 'FAIL', 'LOG_INTERACTION']);

const ACTOR_SUFFIX = (event: string): string => {
  if (SYSTEM.has(event)) return ' (system)';
  if (HUMAN_ONLY.has(event)) return ' (human)';
  return '';
};

const diagram = (lifecycle: (typeof ALL_LIFECYCLES)[number]) => {
  const config = lifecycle.machine.config as {
    initial?: string;
    states?: Readonly<Record<string, StateConfig>>;
  };
  const lines = ['stateDiagram-v2', '  direction LR'];
  for (const initial of lifecycle.initialStates) lines.push(`  [*] --> ${initial}`);
  for (const [state, def] of Object.entries(config.states ?? {})) {
    for (const [event, transition] of Object.entries(def.on ?? {})) {
      const target = typeof transition === 'string' ? transition : (transition.target ?? state);
      const guard = typeof transition === 'string' ? undefined : transition.guard;
      const actor = ACTOR_SUFFIX(event);
      lines.push(
        `  ${state} --> ${target.replace(/^\./, '')} : ${event}${guard ? ` [${guard}]` : ''}${actor}`,
      );
    }
    if (def.type === 'final') lines.push(`  ${state} --> [*]`);
  }
  return lines.join('\n');
};

const doc = [
  '# Lifecycles',
  '',
  '> Generated from `packages/domain/src/lifecycles/*.ts` by `pnpm docs:lifecycles`. Do not edit by hand.',
  '> (human) = only a person can send it · (system) = sweep or automatic screening · `[guard]` = condition the machine evaluates.',
  '> Who may send each human event is decided by policy (docs/architecture/identity-and-access.md § 5).',
  '',
  ...ALL_LIFECYCLES.flatMap((l) => [
    `## ${l.name}`,
    '',
    `States: ${l.states.map((s) => `\`${s}\``).join(', ')} · terminal: ${l.terminalStates.length ? l.terminalStates.map((s) => `\`${s}\``).join(', ') : 'none'}`,
    '',
    '```mermaid',
    diagram(l),
    '```',
    '',
  ]),
].join('\n');

const out = fileURLToPath(new URL('../../../docs/architecture/lifecycles.md', import.meta.url));
writeFileSync(out, doc);
console.log(`wrote ${out}`);
