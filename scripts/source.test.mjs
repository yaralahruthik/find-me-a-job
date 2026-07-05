import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, 'source.mjs');
const FIX = join(HERE, 'fixtures');

function run(argv) {
  try {
    const stdout = execFileSync('node', [SCRIPT, ...argv], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { code: 0, stdout, stderr: '' };
  } catch (e) {
    return { code: e.status ?? 1, stdout: e.stdout?.toString() ?? '', stderr: e.stderr?.toString() ?? '' };
  }
}

const severities = (r) => JSON.parse(r.stdout).flags.map((f) => f.severity);

test('lint: the model "finished" ask passes with no flags (exit 0)', () => {
  const r = run(['lint', '--file', join(FIX, 'ask-good.txt'), '--json']);
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(severities(r), [], JSON.stringify(JSON.parse(r.stdout).flags));
});

test('lint: a generic template ask is flagged on every axis, but still exits 0', () => {
  const r = run(['lint', '--file', join(FIX, 'ask-weak.txt'), '--json']);
  assert.equal(r.code, 0, r.stderr);
  const sev = severities(r);
  for (const expected of ['placeholder', 'role-link', 'proof', 'out']) {
    assert.ok(sev.includes(expected), `should flag ${expected}: got ${sev.join(',')}`);
  }
});

test('lint: --message works inline and never gates', () => {
  const r = run(['lint', '--message', 'Hi there, any openings? please refer me', '--json']);
  assert.equal(r.code, 0, r.stderr);
  const sev = severities(r);
  assert.ok(sev.includes('salutation'), '"Hi there" has no personal name');
  assert.ok(sev.includes('role-link'), 'no link or job id');
});

test('lint: a real name in the greeting is not flagged as generic', () => {
  const r = run(['lint', '--message', "Hi Priya, applying to the SDE role (https://x.co/jobs/9). I shipped an API doing 2M calls/day. Refer me? No worries if not.", '--json']);
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(severities(r), [], JSON.stringify(JSON.parse(r.stdout).flags));
});

test('lint: outreach has a tighter length ceiling than referral', () => {
  const body = 'Hi Sam, ' + 'word '.repeat(100) + 'https://x.co no worries if not, I shipped 3 things.';
  const asReferral = severities(run(['lint', '--type', 'referral', '--message', body, '--json']));
  const asOutreach = severities(run(['lint', '--type', 'outreach', '--message', body, '--json']));
  assert.ok(!asReferral.includes('length'), '~108 words is under the 130 referral ceiling');
  assert.ok(asOutreach.includes('length'), '~108 words is over the 90 outreach ceiling');
});

test('lint: --json shape is { type, word_count, flags }', () => {
  const r = run(['lint', '--file', join(FIX, 'ask-good.txt'), '--json']);
  const report = JSON.parse(r.stdout);
  assert.equal(report.type, 'referral');
  assert.equal(typeof report.word_count, 'number');
  assert.ok(Array.isArray(report.flags));
});

test('lint: no message is a usage error (exit 2)', () => {
  const r = run(['lint']);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /--message|--file/);
});

test('no subcommand exits 2 (usage)', () => {
  const r = run([]);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /Usage:/);
});
