import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, 'leads.mjs');
const FIX = join(HERE, 'fixtures');
const PIPE = join(FIX, 'leads-pipeline.yaml');
const URLS = join(FIX, 'leads-urls.txt');

function run(argv) {
  try {
    const stdout = execFileSync('node', [SCRIPT, ...argv], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { code: 0, stdout, stderr: '' };
  } catch (e) {
    return { code: e.status ?? 1, stdout: e.stdout?.toString() ?? '', stderr: e.stderr?.toString() ?? '' };
  }
}

const ingest = (extra = []) => JSON.parse(run(['ingest', '--file', URLS, '--pipeline', PIPE, '--json', ...extra]).stdout);
const rowByLink = (rep, sub) => rep.rows.find((r) => r.link.includes(sub));

// ---------- ingest: candidate rows (Phase 5) ----------

test('ingest: an annotated "url | company | role" line becomes a clean lead row', () => {
  const r = run(['ingest', '--file', URLS, '--pipeline', PIPE, '--json']);
  assert.equal(r.code, 0, r.stderr);
  const row = rowByLink(JSON.parse(r.stdout), 'linkedin.com/jobs/view/123');
  assert.equal(row.company, 'Notion');
  assert.equal(row.role, 'Frontend Engineer');
  assert.equal(row.channel, 'cold-portal');
  assert.equal(row.stage, 'lead');
  assert.equal(row.closed, false);
});

test('ingest: channel is inferred for aggregators, assumed for unknown company hosts', () => {
  const rep = ingest();
  assert.ok(rowByLink(rep, 'linkedin.com/jobs/view/123').flags.includes('channel-inferred'));
  assert.ok(rowByLink(rep, 'acme.co/careers').flags.includes('channel-assumed'));
});

test('ingest: an id colliding with an existing tracker id gets -N', () => {
  // fixture already has id "notion-frontend-engineer"; ingesting Notion/Frontend Engineer collides
  const rep = ingest();
  assert.equal(rowByLink(rep, 'linkedin.com/jobs/view/123').id, 'notion-frontend-engineer-2');
});

test('ingest: two batch rows with the same company+role get distinct ids', () => {
  const rep = ingest();
  const ids = rep.rows.filter((r) => r.company === 'Globex').map((r) => r.id);
  assert.deepEqual(ids.sort(), ['globex-sde', 'globex-sde-2']);
});

test('ingest: a URL already in the tracker is a duplicate, not a new row', () => {
  const rep = ingest();
  assert.equal(rep.duplicates.length, 1);
  assert.equal(rep.duplicates[0].existing_id, 'acme-frontend');
  assert.ok(!rep.rows.some((r) => r.link.includes('boards.example')), 'the dup is not re-emitted as a row');
});

test('ingest: a line with no URL is rejected, never a lead', () => {
  const rep = ingest();
  assert.equal(rep.rejected.length, 1);
  assert.equal(rep.rejected[0].reason, 'no-link');
  assert.match(rep.rejected[0].line, /just a note/);
});

test('ingest: unannotated company/role are guessed from host+path and flagged to confirm', () => {
  const row = rowByLink(ingest(), 'acme.co/careers');
  assert.equal(row.company, 'Acme');
  assert.equal(row.role, 'Backend Engineer');
  assert.ok(row.flags.includes('company-guessed'));
  assert.ok(row.flags.includes('role-guessed'));
});

test('ingest: a numeric-tail board URL yields no role/company guess (missing, not invented)', () => {
  const row = rowByLink(ingest(), 'linkedin.com/jobs/view/456');
  assert.equal(row.company, '');
  assert.equal(row.role, '');
  assert.ok(row.flags.includes('company-missing'));
  assert.ok(row.flags.includes('role-missing'));
});

test('ingest: --urls works inline and comments/blanks in --file are ignored', () => {
  const r = run(['ingest', '--urls', 'https://linkedin.com/jobs/view/1,https://acme.io/careers/data-engineer', '--pipeline', PIPE, '--json']);
  assert.equal(r.code, 0, r.stderr);
  const rep = JSON.parse(r.stdout);
  assert.equal(rep.count, 2);
  // the --file run drops the "#" comment and the blank line: 5 rows + 1 dup + 1 rejected = 7 content lines
  const fileRep = ingest();
  assert.equal(fileRep.count + fileRep.duplicates.length + fileRep.rejected.length, 7);
});

test('ingest: always exits 0 with valid input, and --json has the documented shape', () => {
  const r = run(['ingest', '--file', URLS, '--pipeline', PIPE, '--json']);
  assert.equal(r.code, 0);
  const rep = JSON.parse(r.stdout);
  assert.equal(typeof rep.count, 'number');
  assert.ok(Array.isArray(rep.rows) && Array.isArray(rep.duplicates) && Array.isArray(rep.rejected));
});

test('ingest: an explicit --pipeline that is missing is an error (exit 3)', () => {
  const r = run(['ingest', '--urls', 'https://x.co/a', '--pipeline', join(FIX, 'does-not-exist.yaml')]);
  assert.equal(r.code, 3);
});

test('ingest: no --file/--urls is a usage error (exit 2)', () => {
  const r = run(['ingest', '--pipeline', PIPE]);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /--urls|--file/);
});

test('no subcommand exits 2 (usage)', () => {
  const r = run([]);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /Usage:/);
});
