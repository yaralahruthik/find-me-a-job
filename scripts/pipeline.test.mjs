import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, 'pipeline.mjs');
const FIX = join(HERE, 'fixtures');
const EXAMPLE = join(HERE, '..', 'data', 'pipeline.example.yaml');

// Run the script; return { code, stdout, stderr }. Never throws on nonzero exit.
function run(argv) {
  try {
    const stdout = execFileSync('node', [SCRIPT, ...argv], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { code: 0, stdout, stderr: '' };
  } catch (e) {
    return { code: e.status ?? 1, stdout: e.stdout?.toString() ?? '', stderr: e.stderr?.toString() ?? '' };
  }
}

const freshState = () => join(mkdtempSync(join(tmpdir(), 'job-state-')), 's.json');

test('valid fixture passes validation (exit 0)', () => {
  const r = run(['validate', '--file', join(FIX, 'valid.yaml'), '--state', freshState()]);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /Data is clean/);
});

const badCases = [
  ['bad-stage.yaml', /unknown stage "phone-screen"/],
  ['bad-channel.yaml', /unknown channel "linkedin-easy-apply"/],
  ['missing-required.yaml', /missing required field "link"/],
  ['illegal-dates.yaml', /is before the previous event/],
  ['stage-date-mismatch.yaml', /latest history stage is "response"/],
  ['duplicate-id.yaml', /duplicate id/],
  ['referral-no-referrer.yaml', /requires a "referrer"/],
  ['bad-ask-lead.yaml', /lead_id "nonexistent-company" does not match/],
];

for (const [file, re] of badCases) {
  test(`${file} fails validation (exit 1) with the right message`, () => {
    const r = run(['validate', '--file', join(FIX, file), '--state', freshState()]);
    assert.equal(r.code, 1);
    assert.match(r.stderr, re);
  });
}

test('metrics refuses to run on invalid data (exit 1)', () => {
  const r = run(['metrics', '--file', join(FIX, 'bad-stage.yaml'), '--week', '2026-W27']);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /Refusing to compute metrics/);
});

test('missing file exits 3 and points at /fh init', () => {
  const r = run(['validate', '--file', join(FIX, 'does-not-exist.yaml')]);
  assert.equal(r.code, 3);
  assert.match(r.stderr, /Run \/fh init/);
});

test('no subcommand exits 2 (usage)', () => {
  const r = run([]);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /Usage:/);
});

test('stage-regression guard blocks backward moves, --accept-corrections clears it', () => {
  const dir = mkdtempSync(join(tmpdir(), 'job-guard-'));
  const file = join(dir, 'pipeline.yaml');
  const state = join(dir, 's.json');
  const advanced = `version: 1
entries:
  - id: acme
    company: Acme
    role: FE
    link: https://a.example/x
    channel: cold-portal
    stage: screen
    closed: false
    history:
      - { stage: applied,  date: 2026-06-20 }
      - { stage: response, date: 2026-06-24 }
      - { stage: screen,   date: 2026-06-28 }
`;
  const regressed = `version: 1
entries:
  - id: acme
    company: Acme
    role: FE
    link: https://a.example/x
    channel: cold-portal
    stage: applied
    closed: false
    history:
      - { stage: applied, date: 2026-06-20 }
`;

  writeFileSync(file, advanced);
  assert.equal(run(['validate', '--file', file, '--state', state]).code, 0, 'first validate should pass and snapshot');

  writeFileSync(file, regressed);
  const blocked = run(['validate', '--file', file, '--state', state]);
  assert.equal(blocked.code, 1, 'backward stage move should be blocked');
  assert.match(blocked.stderr, /moved backward screen -> applied/);

  const overridden = run(['validate', '--file', file, '--state', state, '--accept-corrections']);
  assert.equal(overridden.code, 0, '--accept-corrections should clear the guard');

  rmSync(dir, { recursive: true, force: true });
});

test('golden metrics over the example, week 2026-W27', () => {
  const r = run(['metrics', '--file', EXAMPLE, '--week', '2026-W27', '--json']);
  assert.equal(r.code, 0, r.stderr);
  const m = JSON.parse(r.stdout);

  assert.equal(m.week, '2026-W27');
  assert.deepEqual(m.window, { start: '2026-06-29', end: '2026-07-05' });

  assert.equal(m.applications.total, 6);
  assert.equal(m.applications.by_channel['cold-portal'], 4);
  assert.equal(m.applications.by_channel['referral'], 1);
  assert.equal(m.applications.by_channel['outreach'], 1);

  assert.equal(m.asks.referral.count, 2);
  assert.equal(m.asks.outreach.count, 1);

  assert.equal(m.response_rates.by_channel['cold-portal'].n, 8);
  assert.equal(m.response_rates.by_channel['cold-portal'].reached, 1);
  assert.equal(m.response_rates.by_channel['referral'].n, 3);
  assert.equal(m.response_rates.by_channel['referral'].reached, 2);

  // Every channel is under min_sample=20, so nothing is diagnosable: volume is the job.
  assert.equal(m.bottleneck, null);
  assert.match(m.bottleneck_reason, /volume/);
  assert.equal(m.leads_remaining, 2);
  assert.deepEqual(m.leads_by_channel, { 'cold-portal': 1, referral: 1 });
  assert.equal(m.cold_share.warning, false);
});

// ---------- interviews (the live screens + loops; informs /fh loop) ----------

const INTERVIEWS = join(FIX, 'interviews.yaml');

test('interviews: lists only open screen+loop, stalest first, with the right fields', () => {
  const r = run(['interviews', '--file', INTERVIEWS, '--json']);
  assert.equal(r.code, 0, r.stderr);
  const rep = JSON.parse(r.stdout);
  assert.equal(rep.count, 2, 'lead/applied/response/offer and the closed loop are all excluded');
  // stalest first: open-loop's last event (its 2nd round, 2026-05-02) predates open-screen's (2026-05-20).
  assert.deepEqual(rep.interviews.map((i) => i.id), ['open-loop', 'open-screen']);
  assert.equal(rep.interviews[0].stage, 'loop');
  assert.equal(rep.interviews[0].last_date, '2026-05-02', 'last_date tracks the latest event, i.e. the most recent round');
  assert.equal(rep.interviews[0].rounds, 2, 'open-loop has two dated loop rounds');
  assert.equal(rep.interviews[1].stage, 'screen');
  assert.equal(rep.interviews[1].last_date, '2026-05-20');
  assert.equal(rep.interviews[1].rounds, 0, 'a screen has no loop rounds yet');
  assert.ok(rep.interviews[0].days_since >= rep.interviews[1].days_since, 'stalest carries the larger days_since');
  assert.equal(typeof rep.interviews[0].days_since, 'number');
});

test('interviews: an all-resolved tracker yields count 0 (exit 0)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'job-iv-'));
  const file = join(dir, 'pipeline.yaml');
  writeFileSync(file, `version: 1
entries:
  - id: only-offer
    company: OfferCo
    role: FE
    link: https://x.example/o
    channel: cold-portal
    stage: offer
    closed: false
    history:
      - { stage: applied,  date: 2026-02-01 }
      - { stage: response, date: 2026-02-05 }
      - { stage: screen,   date: 2026-02-12 }
      - { stage: loop,     date: 2026-02-20 }
      - { stage: offer,    date: 2026-02-28 }
`);
  const r = run(['interviews', '--file', file, '--json']);
  assert.equal(r.code, 0, r.stderr);
  const rep = JSON.parse(r.stdout);
  assert.equal(rep.count, 0);
  assert.deepEqual(rep.interviews, []);
  rmSync(dir, { recursive: true, force: true });
});

test('interviews: refuses on invalid data (exit 1), missing file exits 3', () => {
  const bad = run(['interviews', '--file', join(FIX, 'bad-stage.yaml')]);
  assert.equal(bad.code, 1);
  assert.match(bad.stderr, /Refusing to list interviews/);

  const missing = run(['interviews', '--file', join(FIX, 'does-not-exist.yaml')]);
  assert.equal(missing.code, 3);
});

// ---------- history event log ----------

test('a repeated non-loop stage is rejected (only loop rounds may repeat)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'job-hist-'));
  const file = join(dir, 'pipeline.yaml');
  writeFileSync(file, `version: 1
entries:
  - id: dup-response
    company: Acme
    role: FE
    link: https://a.example/x
    channel: cold-portal
    stage: response
    closed: false
    history:
      - { stage: applied,  date: 2026-06-20 }
      - { stage: response, date: 2026-06-24 }
      - { stage: response, date: 2026-06-25 }
`);
  const r = run(['validate', '--file', file, '--state', freshState()]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /"response" appears more than once/);
  rmSync(dir, { recursive: true, force: true });
});

test('migrate: converts a legacy dates{} map to a history[] list (dry run)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'job-mig-'));
  const file = join(dir, 'pipeline.yaml');
  writeFileSync(file, `version: 1
entries:
  - id: acme
    company: Acme
    role: FE
    link: https://a.example/x
    channel: cold-portal
    stage: response
    closed: false
    dates:
      applied: 2026-06-20
      response: 2026-06-24
`);
  const r = run(['migrate', '--file', file]);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /history:/);
  assert.doesNotMatch(r.stdout, /dates:/);
  // dry run leaves the file untouched
  const bad = run(['validate', '--file', file, '--state', freshState()]);
  assert.equal(bad.code, 1, 'legacy file still has no history and fails until --write');
  rmSync(dir, { recursive: true, force: true });
});

// ---------- trends (cumulative funnel as of each past week; informs /fh review) ----------

const TRENDS = join(FIX, 'trends.yaml');

test('trends: reconstructs the cumulative funnel as of each past week', () => {
  // --max-weeks 100 keeps the whole series present regardless of the run date.
  const r = run(['trends', '--file', TRENDS, '--max-weeks', '100', '--json']);
  assert.equal(r.code, 0, r.stderr);
  const rep = JSON.parse(r.stdout);
  const byWeek = Object.fromEntries(rep.weeks.map((w) => [w.week, w.arrows]));

  // series is chronological and starts at the first application's week
  const weeks = rep.weeks.map((w) => w.week);
  assert.deepEqual(weeks, [...weeks].sort(), 'weeks are in chronological order');
  assert.equal(weeks[0], '2026-W19');

  // as of W21: 4 applied, 2 responded; one screen resolved+reached; no loop yet
  assert.equal(byWeek['2026-W21'].app_to_response.n, 4);
  assert.equal(byWeek['2026-W21'].app_to_response.reached, 2);
  assert.equal(byWeek['2026-W21'].response_to_screen.n, 1);
  assert.equal(byWeek['2026-W21'].response_to_screen.reached, 1);
  assert.equal(byWeek['2026-W21'].screen_to_loop.n, 0);

  // as of W23 the loop and offer arrows have appeared
  assert.equal(byWeek['2026-W23'].screen_to_loop.reached, 1);
  assert.equal(byWeek['2026-W23'].loop_to_offer.n, 1);
  assert.equal(byWeek['2026-W23'].loop_to_offer.reached, 1);

  // cumulative: the applied sample only ever grows
  const nSeries = rep.weeks.map((w) => w.arrows.app_to_response.n);
  for (let i = 1; i < nSeries.length; i++) assert.ok(nSeries[i] >= nSeries[i - 1], 'sample is non-decreasing');
});

test('trends: refuses on invalid data (exit 1), missing file exits 3', () => {
  const bad = run(['trends', '--file', join(FIX, 'bad-stage.yaml')]);
  assert.equal(bad.code, 1);
  assert.match(bad.stderr, /Refusing to show trends/);

  const missing = run(['trends', '--file', join(FIX, 'does-not-exist.yaml')]);
  assert.equal(missing.code, 3);
});

// ---------- velocity (time-in-stage + stalls; informs /fh review) ----------

const VELOCITY = join(FIX, 'velocity.yaml');

test('velocity: median time-in-stage reads at a small sample; thin arrows are suppressed', () => {
  const r = run(['velocity', '--file', VELOCITY, '--json']);
  assert.equal(r.code, 0, r.stderr);
  const rep = JSON.parse(r.stdout);
  // applied->response spans are [7, 4, 2] -> median 4 over n=3
  assert.equal(rep.arrows.app_to_response.median_days, 4);
  assert.equal(rep.arrows.app_to_response.n, 3);
  // response->screen has only one span -> below the readable minimum, median suppressed
  assert.equal(rep.arrows.response_to_screen.n, 1);
  assert.equal(rep.arrows.response_to_screen.median_days, null);
});

test('velocity: stale open rows surface as stalls, stalest first', () => {
  const r = run(['velocity', '--file', VELOCITY, '--json']);
  const rep = JSON.parse(r.stdout);
  const ids = rep.stalls.map((s) => s.id);
  assert.deepEqual([...ids].sort(), ['va', 'vb', 'vc'], 'the three old open rows all stall');
  assert.ok(rep.stalls.every((s) => s.days_idle >= rep.stall_days), 'every stall is past the threshold');
  for (let i = 1; i < rep.stalls.length; i++) assert.ok(rep.stalls[i - 1].days_idle >= rep.stalls[i].days_idle);
});

test('velocity: a just-touched open row is not a stall', () => {
  const dir = mkdtempSync(join(tmpdir(), 'job-vel-'));
  const file = join(dir, 'pipeline.yaml');
  const todayStr = new Date().toISOString().slice(0, 10); // fresh by construction, whatever the run date
  writeFileSync(file, `version: 1
entries:
  - id: fresh
    company: FreshCo
    role: FE
    link: https://x.example/fresh
    channel: cold-portal
    stage: applied
    closed: false
    history:
      - { stage: applied, date: ${todayStr} }
`);
  const rep = JSON.parse(run(['velocity', '--file', file, '--json']).stdout);
  assert.deepEqual(rep.stalls, [], 'an application logged today has not stalled');
  rmSync(dir, { recursive: true, force: true });
});

test('velocity: refuses on invalid data (exit 1), missing file exits 3', () => {
  const bad = run(['velocity', '--file', join(FIX, 'bad-stage.yaml')]);
  assert.equal(bad.code, 1);
  assert.match(bad.stderr, /Refusing to show velocity/);

  const missing = run(['velocity', '--file', join(FIX, 'does-not-exist.yaml')]);
  assert.equal(missing.code, 3);
});
