// Docs check (`pnpm docs:check`): the docs may only cite things that exist.
//
// Scope
// - Every Markdown file tracked by git (`git ls-files '*.md'`), outside
//   node_modules.
// - docs/archive/** and docs/qa/reports/** are dated records: they describe the
//   repository as it was on their date, so they may cite paths that have since
//   moved. Their relative links are still checked; cited paths and banned terms
//   are not.
// - Fenced code blocks are skipped (commands, not citations).
//
// Checks
// 1. link     Every relative Markdown link resolves to a file or directory.
// 2. path     Every backticked span that starts with a top-level directory of
//             this repository (apps/, packages/, docs/, scripts/, tools/,
//             .github/, .claude/) resolves. Globs and placeholders (`*`, `<`,
//             `{`, `YYYY`, `:param`) are skipped. Spans without such a prefix
//             (e.g. `support/home.ts`) are relative to prose context and are
//             not checked.
// 3. banned   Banned terms (BANNED below), in docs and, where noted, source.
// 4. adr      docs/adr/README.md lists every docs/adr/NNNN-*.md and nothing else.
//
// A dead link or path is allowed only when its line, or the line before it in
// the same paragraph, marks it as not yet real: "planned", "proposed", "not
// yet", "not built", "does not exist", "introduce", or a conditional sentence
// starting with "If" ("If background work grows, introduce `apps/worker`").
// Template placeholders (`NNNN`, `...`) are skipped.
//
// Output: `file:line  kind  detail`, a count, and exit code 1 on any failure.
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SELF = relative(ROOT, fileURLToPath(import.meta.url));

const RECORDS = [/^docs\/archive\//, /^docs\/qa\/reports\//];
const ROOT_DIRS = ['apps/', 'packages/', 'docs/', 'scripts/', 'tools/', '.github/', '.claude/'];
const NOT_YET_WORDS = /\b(planned|proposed|not yet|not built|does not exist|introduce)\b/i;
const notYet = (text) => NOT_YET_WORDS.test(text) || /\bIf\b/.test(text);

/**
 * Banned terms. `docs` applies to Markdown in scope; `source` to tracked
 * TypeScript, JSON and config files. Negations ("there are no points") are
 * fine: the points patterns only match points used as a unit.
 */
const BANNED = [
  {
    name: 'points as a credit unit',
    reason: 'Credit is demonstrations, not points (ADR 0007 amendment, CONTEXT.md).',
    pattern:
      /\b\d+\s+points?\b(?![-\w]*\s+(?:at|to)\b)|\b(?:earn(?:s|ed|ing)?|award(?:s|ed)?|score[sd]?|gain(?:s|ed)?)\s+(?:\w+\s+)?points?\b|\bcredit\s+points?\b|\bpoints?\s+(?:per|balance|total|threshold)\b|\btotal\s+points?\b/i,
    allow: /\b(no|not|never|gone|superseded|replaced?|instead of|no longer|removed)\b/i,
    docs: true,
    source: ['apps/web/src/', 'packages/ui/src/'],
  },
  {
    name: '@cc package scope',
    reason: 'Package names stay product-neutral (@repo/*).',
    pattern: /@cc\//,
    docs: true,
    source: [''],
  },
];

const git = (...args) =>
  execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean);

const failures = [];
const fail = (file, line, kind, detail) => failures.push({ file, line, kind, detail });

const exists = (path) => existsSync(path);

const markdown = git('ls-files', '*.md').filter((f) => !f.includes('node_modules/'));

/** Lines outside fenced code blocks, with 1-based line numbers. */
const proseLines = (text) => {
  const out = [];
  let fence = null;
  text.split('\n').forEach((line, index) => {
    const marker = line.match(/^\s*(```+|~~~+)/);
    if (marker) {
      if (fence === null) fence = marker[1][0];
      else if (marker[1][0] === fence) fence = null;
      return;
    }
    if (fence === null) out.push({ line, number: index + 1 });
  });
  return out;
};

const stripInlineCode = (line) => line.replace(/`[^`]*`/g, (m) => ' '.repeat(m.length));

const isPlaceholder = (span) => /[*<>{}]|YYYY|\/:[a-z]|\s/i.test(span);

for (const file of markdown) {
  const text = readFileSync(join(ROOT, file), 'utf8');
  const record = RECORDS.some((r) => r.test(file));
  let previous = '';
  for (const { line, number } of proseLines(text)) {
    const context = `${previous}\n${line}`;
    previous = line.trim() === '' ? '' : line;
    // 1. Relative links (inline code removed so `[a](b)` examples don't count).
    for (const match of stripInlineCode(line).matchAll(/\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
      const target = match[1];
      if (/^(?:[a-z][a-z0-9+.-]*:|#|\/\/)/i.test(target)) continue;
      const path = decodeURIComponent(target.split('#')[0].split('?')[0]);
      if (path === '' || /NNNN|\.\.\.|[<>]/.test(path)) continue;
      const absolute = path.startsWith('/') ? join(ROOT, path) : resolve(ROOT, dirname(file), path);
      if (!exists(absolute) && !notYet(context)) fail(file, number, 'link', target);
    }
    if (record) continue;
    // 2. Backticked repository paths.
    for (const match of line.matchAll(/`([^`]+)`/g)) {
      const span = match[1].trim();
      if (!ROOT_DIRS.some((dir) => span.startsWith(dir)) || isPlaceholder(span)) continue;
      const path = span.replace(/[.,;:]+$/, '').replace(/#.*$/, '');
      if (!exists(join(ROOT, path)) && !notYet(context)) fail(file, number, 'path', span);
    }
    // 3. Banned terms in docs.
    for (const term of BANNED.filter((t) => t.docs)) {
      if (term.pattern.test(line) && !(term.allow && term.allow.test(line)))
        fail(file, number, 'banned', `${term.name}: ${line.trim().slice(0, 100)}`);
    }
  }
}

// 3. Banned terms in source.
const source = git('ls-files').filter(
  (f) =>
    f !== SELF &&
    !f.includes('node_modules/') &&
    !f.endsWith('.md') &&
    !f.endsWith('pnpm-lock.yaml') &&
    /\.(?:[cm]?[jt]sx?|json|ya?ml|css|html)$/.test(f),
);
for (const term of BANNED) {
  for (const file of source.filter((f) => term.source.some((prefix) => f.startsWith(prefix)))) {
    if (!exists(join(ROOT, file))) continue;
    readFileSync(join(ROOT, file), 'utf8')
      .split('\n')
      .forEach((line, index) => {
        if (term.pattern.test(line) && !(term.allow && term.allow.test(line)))
          fail(file, index + 1, 'banned', `${term.name}: ${line.trim().slice(0, 100)}`);
      });
  }
}

// 4. The ADR index matches the directory.
const ADR_DIR = 'docs/adr';
const INDEX = `${ADR_DIR}/README.md`;
const adrFiles = new Set(readdirSync(join(ROOT, ADR_DIR)).filter((f) => /^\d{4}-.+\.md$/.test(f)));
const indexText = readFileSync(join(ROOT, INDEX), 'utf8');
const indexed = new Map();
indexText.split('\n').forEach((line, index) => {
  for (const match of line.matchAll(/\]\(\.?\/?(\d{4}-[^)#\s]+\.md)/g))
    if (!indexed.has(match[1])) indexed.set(match[1], index + 1);
});
for (const adr of adrFiles)
  if (!indexed.has(adr)) fail(INDEX, 1, 'adr', `not listed in the index: ${adr}`);
for (const [adr, line] of indexed)
  if (!adrFiles.has(adr)) fail(INDEX, line, 'adr', `listed but missing: ${adr}`);
const numbers = [...adrFiles].map((f) => f.slice(0, 4));
for (const n of new Set(numbers.filter((x, i) => numbers.indexOf(x) !== i)))
  fail(ADR_DIR, 1, 'adr', `number used twice: ${n}`);

const scanned = `${markdown.length} Markdown files, ${source.length} source files`;
if (failures.length === 0) {
  process.stdout.write(`docs:check passed (${scanned}).\n`);
} else {
  for (const f of failures.toSorted((a, b) => a.file.localeCompare(b.file) || a.line - b.line))
    process.stderr.write(`${f.file}:${f.line}  ${f.kind}  ${f.detail}\n`);
  process.stderr.write(`\ndocs:check failed: ${failures.length} problem(s) in ${scanned}.\n`);
  process.exit(1);
}
