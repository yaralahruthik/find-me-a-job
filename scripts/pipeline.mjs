#!/usr/bin/env node
// pipeline.mjs — the only thing that computes numbers or judges data honesty.
// Two subcommands: `validate` (gate) and `metrics` (the five numbers). The agent
// must never do this arithmetic itself. See core/RULES.md and core/SCHEMA.md.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse, stringify } from 'yaml';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

const STAGES = ['lead', 'applied', 'response', 'screen', 'loop', 'offer'];
const CHANNELS = ['cold-portal', 'referral', 'outreach', 'drive'];
const ASK_TYPES = ['referral', 'outreach'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const idx = (s) => STAGES.indexOf(s);
const reached = (e, s) => idx(e.stage) >= idx(s);

// ---------- history-log helpers ----------
// Each entry carries an ordered `history` event log: [{ stage, date, round?, note? }].
// Non-loop stages appear at most once; `loop` may repeat (one dated event per round).
// The funnel arrows still key off `e.stage`/`reached()`; these read the timeline.
const historyOf = (e) => (Array.isArray(e.history) ? e.history : []);
const dateOf = (e, stage) => { const ev = historyOf(e).find((h) => h && h.stage === stage); return ev ? ev.date : null; };
const hasEvent = (e, stage) => historyOf(e).some((h) => h && h.stage === stage);
const latestEventDate = (e) => historyOf(e).map((h) => h && h.date).filter(Boolean).reduce((a, b) => (a > b ? a : b), null);
const roundsOf = (e) => historyOf(e).filter((h) => h && h.stage === 'loop');
// As of date D, had the entry reached `stage`? (an event at or beyond `stage`, dated on/before D)
const reachedAsOf = (e, stage, D) => historyOf(e).some((h) => h && h.date <= D && idx(h.stage) >= idx(stage));

const DEFAULT_BASELINES = {
  app_to_response: {
    'cold-portal': [0.01, 0.05], referral: [0.15, 0.4],
    outreach: [0.05, 0.15], drive: [0.01, 0.05],
  },
  response_to_screen: [0.3, 0.5], screen_to_loop: [0.4, 0.6], loop_to_offer: [0.1, 0.25],
  min_sample: 20, cold_share_warning: 0.8,
};

// ---------- CLI ----------

function parseArgs(argv) {
  const args = { _: [], flags: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) { args.flags[key] = next; i++; }
      else args.flags[key] = true;
    } else args._.push(a);
  }
  return args;
}

function die(code, msg) { process.stderr.write(msg + '\n'); process.exit(code); }

// ---------- loading ----------

function loadYaml(path, { missingCode } = {}) {
  if (!existsSync(path)) {
    if (missingCode) die(missingCode, `Missing file: ${path}\nRun /fh init to set up your search.`);
    return null;
  }
  try {
    return parse(readFileSync(path, 'utf8'));
  } catch (e) {
    die(3, `Could not parse ${path}: ${e.message}`);
  }
}

function loadBaselines() {
  const user = loadYaml(join(ROOT, 'config/baselines.yaml'));
  const example = loadYaml(join(ROOT, 'config/baselines.example.yaml'));
  return { ...DEFAULT_BASELINES, ...(example || {}), ...(user || {}) };
}

function loadTargets() {
  const p = loadYaml(join(ROOT, 'config/profile.yaml')) || loadYaml(join(ROOT, 'config/profile.example.yaml'));
  return p && p.targets ? p.targets : null;
}

// ---------- date helpers ----------

const today = () => new Date().toISOString().slice(0, 10);

function validDate(s) {
  if (typeof s !== 'string' || !DATE_RE.test(s)) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

// ISO week the given YYYY-MM-DD falls in, as "YYYY-Www".
function isoWeekOf(dateStr) {
  const t = new Date(dateStr + 'T00:00:00Z');
  const day = (t.getUTCDay() + 6) % 7;
  t.setUTCDate(t.getUTCDate() - day + 3);
  const firstThu = new Date(Date.UTC(t.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((t - firstThu) / 86400000 - 3 + ((firstThu.getUTCDay() + 6) % 7)) / 7);
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

// Monday..Sunday (inclusive) date strings for a "YYYY-Www".
function weekRange(weekStr) {
  const m = /^(\d{4})-W(\d{2})$/.exec(weekStr);
  if (!m) die(2, `Bad --week "${weekStr}" (expected YYYY-Www, e.g. 2026-W27)`);
  const year = +m[1], week = +m[2];
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const jan4Dow = (jan4.getUTCDay() + 6) % 7;
  const monday = new Date(jan4);
  monday.setUTCDate(jan4.getUTCDate() - jan4Dow + (week - 1) * 7);
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);
  return { start: monday.toISOString().slice(0, 10), end: sunday.toISOString().slice(0, 10) };
}

const inWindow = (d, w) => !!d && d >= w.start && d <= w.end;

const daysBetween = (fromStr, toStr) =>
  Math.round((new Date(toStr + 'T00:00:00Z') - new Date(fromStr + 'T00:00:00Z')) / 86400000);

const addDays = (dateStr, n) =>
  new Date(new Date(dateStr + 'T00:00:00Z').getTime() + n * 86400000).toISOString().slice(0, 10);

// ---------- validation ----------

function validateStructure(doc) {
  const errors = [];
  if (doc === null || typeof doc !== 'object') return ['file is empty or not a mapping'];
  const entries = doc.entries;
  if (entries === undefined) return ['missing top-level "entries" list'];
  if (!Array.isArray(entries)) return ['"entries" must be a list'];

  const seenIds = new Set();
  const ids = new Set();
  for (const e of entries) if (e && typeof e === 'object' && e.id) ids.add(e.id);

  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    const where = e && e.id ? `entry "${e.id}"` : `entry #${i + 1}`;
    if (!e || typeof e !== 'object') { errors.push(`${where}: not a mapping`); continue; }

    for (const f of ['id', 'company', 'role', 'link', 'channel', 'stage']) {
      if (e[f] === undefined || e[f] === null || e[f] === '') errors.push(`${where}: missing required field "${f}"`);
    }
    if (typeof e.closed !== 'boolean') errors.push(`${where}: "closed" must be true or false`);

    if (e.id) {
      if (seenIds.has(e.id)) errors.push(`${where}: duplicate id`);
      seenIds.add(e.id);
    }
    if (e.channel !== undefined && !CHANNELS.includes(e.channel))
      errors.push(`${where}: unknown channel "${e.channel}" (allowed: ${CHANNELS.join(' | ')})`);
    if (e.stage !== undefined && !STAGES.includes(e.stage))
      errors.push(`${where}: unknown stage "${e.stage}" (allowed: ${STAGES.join(' | ')})`);

    // closed_date <-> closed
    if (e.closed === true && !e.closed_date) errors.push(`${where}: closed is true but closed_date is missing`);
    if (e.closed !== true && e.closed_date) errors.push(`${where}: closed_date set but closed is not true`);
    if (e.closed_date && !validDate(e.closed_date)) errors.push(`${where}: closed_date "${e.closed_date}" is not a valid non-future YYYY-MM-DD`);
    if (e.closed_date && validDate(e.closed_date) && e.closed_date > today()) errors.push(`${where}: closed_date "${e.closed_date}" is in the future`);

    // history event log — ordered [{ stage, date, round?, note? }]
    const history = e.history;
    if (history !== undefined && !Array.isArray(history)) {
      errors.push(`${where}: "history" must be a list of { stage, date } events`);
    } else if (Array.isArray(history) && STAGES.includes(e.stage)) {
      let ok = true;
      const seenNonLoop = new Set();
      for (let j = 0; j < history.length; j++) {
        const h = history[j];
        const at = `${where}: history[${j}]`;
        if (!h || typeof h !== 'object' || Array.isArray(h)) { errors.push(`${at} is not a mapping`); ok = false; continue; }
        if (!STAGES.includes(h.stage)) { errors.push(`${at} has unknown stage "${h.stage}"`); ok = false; }
        else {
          if (idx(h.stage) > idx(e.stage)) { errors.push(`${at} stage "${h.stage}" is beyond current stage "${e.stage}"`); ok = false; }
          if (h.stage !== 'loop') {
            if (seenNonLoop.has(h.stage)) { errors.push(`${at} stage "${h.stage}" appears more than once (only loop rounds may repeat)`); ok = false; }
            seenNonLoop.add(h.stage);
          }
        }
        if (!validDate(h.date)) { errors.push(`${at} date "${h.date}" is not a valid YYYY-MM-DD`); ok = false; }
        else if (h.date > today()) { errors.push(`${at} date "${h.date}" is in the future`); ok = false; }
        if (h.round !== undefined && typeof h.round !== 'string') { errors.push(`${at} "round" must be a string`); ok = false; }
        if (h.note !== undefined && typeof h.note !== 'string') { errors.push(`${at} "note" must be a string`); ok = false; }
      }
      if (ok) {
        // events weakly non-decreasing by (stage order, date) in list order
        for (let j = 1; j < history.length; j++) {
          const prev = history[j - 1], cur = history[j];
          if (idx(cur.stage) < idx(prev.stage))
            errors.push(`${where}: history[${j}] stage "${cur.stage}" comes after later stage "${prev.stage}" (events must be in pipeline order)`);
          else if (cur.date < prev.date)
            errors.push(`${where}: history[${j}] date ${cur.date} is before the previous event ${prev.date}`);
        }
        // stage must equal the highest-order stage in history
        const maxStage = history.reduce((m, h) => (m === null || idx(h.stage) > idx(m) ? h.stage : m), null);
        if (maxStage && maxStage !== e.stage)
          errors.push(`${where}: stage is "${e.stage}" but the latest history stage is "${maxStage}" — move the stage or add the event`);
        if (history.length === 0 && e.stage !== 'lead')
          errors.push(`${where}: stage is "${e.stage}" but "history" has no events`);
      }
    }

    // required-by-stage
    if (STAGES.includes(e.stage) && idx(e.stage) >= idx('applied')) {
      if (!hasEvent(e, 'applied')) errors.push(`${where}: stage is "${e.stage}" but there is no "applied" event in history`);
      if (e.channel === 'referral' && !e.referrer) errors.push(`${where}: referral channel at stage "${e.stage}" requires a "referrer"`);
    }
  }

  // asks
  const asks = doc.asks;
  if (asks !== undefined) {
    if (!Array.isArray(asks)) errors.push('"asks" must be a list');
    else asks.forEach((a, i) => {
      const where = `ask #${i + 1}`;
      if (!a || typeof a !== 'object') { errors.push(`${where}: not a mapping`); return; }
      if (!a.date) errors.push(`${where}: missing "date"`);
      else if (!validDate(a.date)) errors.push(`${where}: date "${a.date}" is not a valid YYYY-MM-DD`);
      else if (a.date > today()) errors.push(`${where}: date "${a.date}" is in the future`);
      if (!a.type || !ASK_TYPES.includes(a.type)) errors.push(`${where}: type must be one of ${ASK_TYPES.join(' | ')}`);
      if (!a.person) errors.push(`${where}: missing "person"`);
      if (a.lead_id && !ids.has(a.lead_id)) errors.push(`${where}: lead_id "${a.lead_id}" does not match any entry id`);
    });
  }

  return errors;
}

function snapshotOf(doc) {
  const snap = {};
  for (const e of doc.entries || []) if (e && e.id) snap[e.id] = { stage: e.stage, closed: !!e.closed };
  return snap;
}

function regressionErrors(doc, statePath) {
  if (!existsSync(statePath)) return [];
  let prev;
  try { prev = JSON.parse(readFileSync(statePath, 'utf8')); } catch { return []; }
  const errors = [];
  const cur = snapshotOf(doc);
  for (const id of Object.keys(prev)) {
    if (!(id in cur)) { errors.push(`entry "${id}": was tracked before and has vanished (rows are never deleted — mark closed instead). Pass --accept-corrections if this was intentional.`); continue; }
    if (idx(cur[id].stage) < idx(prev[id].stage))
      errors.push(`entry "${id}": stage moved backward ${prev[id].stage} -> ${cur[id].stage} (stages only advance; a rejection sets closed and keeps the stage). Pass --accept-corrections if this is a genuine fix.`);
  }
  return errors;
}

function writeSnapshot(doc, statePath) {
  mkdirSync(dirname(statePath), { recursive: true });
  writeFileSync(statePath, JSON.stringify(snapshotOf(doc), null, 2) + '\n');
}

// ---------- metrics ----------

function verdict(rate, n, range, minSample) {
  if (n < minSample) return 'insufficient-sample';
  if (rate < range[0]) return 'below';
  if (rate > range[1]) return 'above';
  return 'in-range';
}

function computeMetrics(doc, weekStr, baselines, targets) {
  const entries = (doc.entries || []).filter((e) => e && e.id);
  const window = weekRange(weekStr);
  const minSample = baselines.min_sample ?? 20;
  const applications = entries.filter((e) => idx(e.stage) >= idx('applied'));

  // 1. applications this week by channel
  const appsThisWeek = applications.filter((e) => inWindow(dateOf(e, 'applied'), window));
  const byChannelWeek = {};
  for (const c of CHANNELS) byChannelWeek[c] = appsThisWeek.filter((e) => e.channel === c).length;

  // 2. asks this week
  const asks = (doc.asks || []).filter((a) => inWindow(a.date, window));
  const askCounts = { referral: asks.filter((a) => a.type === 'referral').length, outreach: asks.filter((a) => a.type === 'outreach').length };

  // 3. response rate by channel (cumulative; silence in the denominator; no maturity window)
  const respByChannel = {};
  for (const c of CHANNELS) {
    const den = applications.filter((e) => e.channel === c);
    const num = den.filter((e) => reached(e, 'response'));
    const rate = den.length ? num.length / den.length : 0;
    respByChannel[c] = {
      n: den.length, reached: num.length, rate,
      baseline: baselines.app_to_response[c],
      verdict: verdict(rate, den.length, baselines.app_to_response[c], minSample),
    };
  }

  // 4. later arrows (resolved rows only as denominator)
  function arrow(from, to, rangeKey) {
    const eligible = applications.filter((e) => reached(e, from));
    const resolved = eligible.filter((e) => reached(e, to) || e.closed);
    const num = resolved.filter((e) => reached(e, to));
    const rate = resolved.length ? num.length / resolved.length : 0;
    return { n: resolved.length, reached: num.length, rate, baseline: baselines[rangeKey], verdict: verdict(rate, resolved.length, baselines[rangeKey], minSample) };
  }
  const funnel = {
    app_to_response: { by_channel: respByChannel },
    response_to_screen: arrow('response', 'screen', 'response_to_screen'),
    screen_to_loop: arrow('screen', 'loop', 'screen_to_loop'),
    loop_to_offer: arrow('loop', 'offer', 'loop_to_offer'),
  };

  // bottleneck: earliest arrow in pipeline order that is callable and below baseline
  let bottleneck = null, reason = '';
  const belowChannels = Object.entries(respByChannel).filter(([, d]) => d.verdict === 'below').sort((a, b) => b[1].n - a[1].n);
  if (belowChannels.length) {
    const [c, d] = belowChannels[0];
    bottleneck = { arrow: `applied->response (${c})`, ...d };
  } else {
    for (const key of ['response_to_screen', 'screen_to_loop', 'loop_to_offer']) {
      if (funnel[key].verdict === 'below') { bottleneck = { arrow: key, ...funnel[key] }; break; }
    }
  }
  if (!bottleneck) {
    const anyCallable = Object.values(respByChannel).some((d) => d.verdict !== 'insufficient-sample')
      || ['response_to_screen', 'screen_to_loop', 'loop_to_offer'].some((k) => funnel[k].verdict !== 'insufficient-sample');
    reason = anyCallable
      ? 'no arrow is below baseline with a real sample — the funnel is within range where it can be measured'
      : 'samples too small to diagnose a bottleneck — this week\'s job is volume';
  }

  // cold share (cumulative) + leads
  const coldShare = applications.length ? respByChannel['cold-portal'].n / applications.length : 0;
  const openLeads = entries.filter((e) => e.stage === 'lead' && !e.closed);
  const leadsRemaining = openLeads.length;
  const leadsByChannel = {};
  for (const c of CHANNELS) {
    const n = openLeads.filter((e) => e.channel === c).length;
    if (n) leadsByChannel[c] = n;
  }

  return {
    week: weekStr, window,
    applications: { by_channel: byChannelWeek, total: appsThisWeek.length, target: targets?.applications ?? null },
    asks: {
      referral: { count: askCounts.referral, target: targets?.referral_asks ?? null },
      outreach: { count: askCounts.outreach, target: targets?.outreach_messages ?? null },
    },
    response_rates: { by_channel: respByChannel },
    funnel,
    bottleneck, bottleneck_reason: reason,
    leads_remaining: leadsRemaining,
    leads_by_channel: leadsByChannel,
    cold_share: { fraction: coldShare, warning: coldShare > (baselines.cold_share_warning ?? 0.8) && applications.length > 0 },
    prep_hours_target: targets?.prep_hours ?? null,
    validation: 'ok',
  };
}

// ---------- human rendering ----------

const pct = (x) => (x * 100).toFixed(0) + '%';
function tgt(count, target) { return target == null ? `${count}` : `${count} / ${target}`; }

function renderMetrics(m) {
  const L = [];
  L.push(`Week ${m.week}  (${m.window.start} .. ${m.window.end})`);
  L.push('');
  L.push('1. Applications this week, by channel');
  for (const c of CHANNELS) if (m.applications.by_channel[c]) L.push(`     ${c.padEnd(12)} ${m.applications.by_channel[c]}`);
  L.push(`     ${'TOTAL'.padEnd(12)} ${tgt(m.applications.total, m.applications.target)}`);
  L.push('');
  L.push('2. Asks this week');
  L.push(`     referral asks     ${tgt(m.asks.referral.count, m.asks.referral.target)}`);
  L.push(`     outreach messages ${tgt(m.asks.outreach.count, m.asks.outreach.target)}`);
  L.push('');
  L.push('3. Response rate by channel (cumulative — silence counts)');
  for (const c of CHANNELS) {
    const d = m.response_rates.by_channel[c];
    if (!d.n) continue;
    const base = d.baseline ? `[${pct(d.baseline[0])}-${pct(d.baseline[1])}]` : '';
    const tag = d.verdict === 'insufficient-sample' ? `n=${d.n} (too few to judge)` : `${d.verdict} vs ${base}`;
    L.push(`     ${c.padEnd(12)} ${d.reached}/${d.n} = ${pct(d.rate)}   ${tag}`);
  }
  L.push('');
  L.push('4. Bottleneck arrow');
  if (m.bottleneck) L.push(`     ${m.bottleneck.arrow}: ${m.bottleneck.reached}/${m.bottleneck.n} = ${pct(m.bottleneck.rate)} (below baseline)`);
  else L.push(`     ${m.bottleneck_reason}`);
  if (m.cold_share.warning) L.push(`     ! ${pct(m.cold_share.fraction)} of applications are cold-portal (>80%). Rebalance toward referrals.`);
  L.push('');
  L.push(`5. Leads remaining: ${m.leads_remaining}`);
  const byChan = Object.entries(m.leads_by_channel || {});
  if (byChan.length) L.push(`     by channel: ${byChan.map(([c, n]) => `${c} ${n}`).join(', ')}`);
  return L.join('\n');
}

// ---------- commands ----------

function cmdValidate(args) {
  const file = args.flags.file || join(ROOT, 'data/pipeline.yaml');
  const statePath = args.flags.state || join(ROOT, 'data/.state/last-validated.json');
  const doc = loadYaml(file, { missingCode: 3 });

  const structural = validateStructure(doc);
  if (structural.length) {
    if (args.flags.json) { process.stdout.write(JSON.stringify({ ok: false, errors: structural }, null, 2) + '\n'); }
    else { structural.forEach((e) => process.stderr.write(`ERROR ${e}\n`)); process.stderr.write(`\n${structural.length} problem(s). Numbers stay hidden until the data is clean.\n`); }
    process.exit(1);
  }

  const regression = args.flags['accept-corrections'] ? [] : regressionErrors(doc, statePath);
  if (regression.length) {
    if (args.flags.json) process.stdout.write(JSON.stringify({ ok: false, errors: regression }, null, 2) + '\n');
    else { regression.forEach((e) => process.stderr.write(`ERROR ${e}\n`)); }
    process.exit(1);
  }

  writeSnapshot(doc, statePath);
  if (args.flags.json) process.stdout.write(JSON.stringify({ ok: true, entries: (doc.entries || []).length }, null, 2) + '\n');
  else process.stdout.write(`OK — ${(doc.entries || []).length} entries, ${(doc.asks || []).length} asks. Data is clean.\n`);
  process.exit(0);
}

function cmdMetrics(args) {
  const file = args.flags.file || join(ROOT, 'data/pipeline.yaml');
  const doc = loadYaml(file, { missingCode: 3 });

  const structural = validateStructure(doc);
  if (structural.length) {
    process.stderr.write('Refusing to compute metrics: the pipeline data is invalid.\n');
    structural.forEach((e) => process.stderr.write(`ERROR ${e}\n`));
    process.stderr.write('\nRun /fh validate and fix these first.\n');
    process.exit(1);
  }

  const baselines = loadBaselines();
  const targets = loadTargets();
  const week = args.flags.week || isoWeekOf(today());
  const m = computeMetrics(doc, week, baselines, targets);

  if (args.flags.json) process.stdout.write(JSON.stringify(m, null, 2) + '\n');
  else process.stdout.write(renderMetrics(m) + '\n');
  process.exit(0);
}

// ---------- interviews (the live screens + loops; informs /fh loop) ----------

// The in-flight interviews: entries at screen or loop, not closed, stalest first
// (days since the last stage change surfaces the one wanting a follow-up). Loop is
// one stage with a note per round — this lists loops, it never scores rounds.
function computeInterviews(doc) {
  const entries = (doc.entries || []).filter((e) => e && e.id);
  const live = entries.filter((e) => (e.stage === 'screen' || e.stage === 'loop') && e.closed !== true);
  const t = today();
  const interviews = live.map((e) => {
    const last_date = latestEventDate(e);
    return {
      id: e.id, company: e.company, role: e.role, stage: e.stage,
      rounds: roundsOf(e).length,
      last_date, days_since: last_date ? daysBetween(last_date, t) : null,
    };
  });
  interviews.sort((a, b) => (b.days_since ?? -1) - (a.days_since ?? -1));
  return { interviews, count: interviews.length };
}

function renderInterviews(r) {
  if (!r.count) return 'No active interviews (nothing at screen or loop). When a screen turns into a loop, /fh loop preps it.';
  const L = [`${r.count} active interview(s) — stalest first (days since the last stage change):`, ''];
  for (const it of r.interviews) {
    const since = it.days_since == null ? '' : `${it.days_since}d`;
    const rounds = it.rounds > 0 ? `  ${it.rounds} round${it.rounds === 1 ? '' : 's'}` : '';
    L.push(`  ${it.stage.padEnd(6)} ${since.padStart(4)}  ${it.company} · ${it.role}  (${it.id})${rounds}`);
  }
  L.push('');
  L.push('Loop prep is always first priority; a stale one wants a follow-up. Run /fh loop to prep or debrief one.');
  return L.join('\n');
}

function cmdInterviews(args) {
  const file = args.flags.file || join(ROOT, 'data/pipeline.yaml');
  const doc = loadYaml(file, { missingCode: 3 });

  const structural = validateStructure(doc);
  if (structural.length) {
    process.stderr.write('Refusing to list interviews: the pipeline data is invalid.\n');
    structural.forEach((e) => process.stderr.write(`ERROR ${e}\n`));
    process.stderr.write('\nRun /fh validate and fix these first.\n');
    process.exit(1);
  }

  const r = computeInterviews(doc);
  if (args.flags.json) process.stdout.write(JSON.stringify(r, null, 2) + '\n');
  else process.stdout.write(renderInterviews(r) + '\n');
  process.exit(0);
}

// ---------- trends (the funnel, cumulative as of each past week) ----------

// The four funnel arrows. app_to_response counts silence in the denominator
// (every application, like the live metric); the later arrows use resolved rows only.
const TREND_ARROWS = [
  { key: 'app_to_response', from: 'applied', to: 'response', silence: true },
  { key: 'response_to_screen', from: 'response', to: 'screen' },
  { key: 'screen_to_loop', from: 'screen', to: 'loop' },
  { key: 'loop_to_offer', from: 'loop', to: 'offer' },
];

// Reconstruct each funnel arrow AS OF each past week-ending date. Cumulative:
// the population only grows, so samples accumulate and the read stays honest.
function computeTrends(doc, baselines, opts = {}) {
  const applications = (doc.entries || []).filter((e) => e && e.id && hasEvent(e, 'applied'));
  const minSample = baselines.min_sample ?? 20;
  const maxWeeks = opts.maxWeeks ?? 12;

  const appliedDates = applications.map((e) => dateOf(e, 'applied')).filter(Boolean);
  if (!appliedDates.length) return { weeks: [], truncated: false, min_sample: minSample };
  const firstApplied = appliedDates.reduce((a, b) => (a < b ? a : b));

  // walk ISO weeks from the first application's week to the current week
  const endCap = weekRange(isoWeekOf(today())).end;
  const weekStrs = [];
  for (let cursor = weekRange(isoWeekOf(firstApplied)).start; cursor <= endCap; cursor = addDays(cursor, 7))
    weekStrs.push(isoWeekOf(cursor));

  const closedAsOf = (e, D) => e.closed && e.closed_date && e.closed_date <= D;
  function arrowAsOf(a, D) {
    const eligible = applications.filter((e) => reachedAsOf(e, a.from, D));
    const reached = eligible.filter((e) => reachedAsOf(e, a.to, D));
    const resolved = a.silence ? eligible : eligible.filter((e) => reachedAsOf(e, a.to, D) || closedAsOf(e, D));
    const n = resolved.length;
    const rate = n ? reached.length / n : 0;
    const baseline = a.silence ? null : baselines[a.key];
    const v = baseline ? verdict(rate, n, baseline, minSample) : (n < minSample ? 'insufficient-sample' : 'measured');
    return { n, reached: reached.length, rate, baseline, verdict: v };
  }

  let weeks = weekStrs.map((wk) => {
    const D = weekRange(wk).end;
    const arrows = {};
    for (const a of TREND_ARROWS) arrows[a.key] = arrowAsOf(a, D);
    return { week: wk, ending: D, arrows };
  });
  let truncated = false;
  if (weeks.length > maxWeeks) { weeks = weeks.slice(-maxWeeks); truncated = true; }
  return { weeks, truncated, min_sample: minSample };
}

function renderTrends(r) {
  if (!r.weeks.length) return 'Not enough history yet — trends read from a few weeks of applications in.';
  const L = ['Funnel, cumulative as of each week-ending — rate (resolved sample n):'];
  if (r.truncated) L.push(`(showing the most recent ${r.weeks.length} weeks)`);
  L.push('');
  L.push('  ' + ['week    ', 'app→resp', 'resp→scr', 'scr→loop', 'loop→off'].join('  '));
  for (const w of r.weeks) {
    const cells = TREND_ARROWS.map(({ key }) => {
      const d = w.arrows[key];
      if (d.n < r.min_sample) return `—(${d.n})`.padEnd(8);
      return `${pct(d.rate)}(${d.n})${d.verdict === 'below' ? '↓' : ''}`.padEnd(8);
    });
    L.push(`  ${w.week}  ${cells.join('  ')}`);
  }
  L.push('');
  L.push('Samples grow left→right; read an arrow only once its n clears the baseline sample. ↓ = below baseline.');
  return L.join('\n');
}

function cmdTrends(args) {
  const file = args.flags.file || join(ROOT, 'data/pipeline.yaml');
  const doc = loadYaml(file, { missingCode: 3 });

  const structural = validateStructure(doc);
  if (structural.length) {
    process.stderr.write('Refusing to show trends: the pipeline data is invalid.\n');
    structural.forEach((e) => process.stderr.write(`ERROR ${e}\n`));
    process.stderr.write('\nRun /fh validate and fix these first.\n');
    process.exit(1);
  }

  const maxWeeks = args.flags['max-weeks'] ? Number(args.flags['max-weeks']) : undefined;
  const r = computeTrends(doc, loadBaselines(), { maxWeeks });
  if (args.flags.json) process.stdout.write(JSON.stringify(r, null, 2) + '\n');
  else process.stdout.write(renderTrends(r) + '\n');
  process.exit(0);
}

// ---------- velocity (time-in-stage + stalls; informs /fh review) ----------

function median(nums) {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}

const VELOCITY_ARROWS = [
  ['app_to_response', 'applied', 'response'],
  ['response_to_screen', 'response', 'screen'],
  ['screen_to_loop', 'screen', 'loop'],
  ['loop_to_offer', 'loop', 'offer'],
];

// How long applications sit at each stage before moving (median days between the
// two dated events, among entries that recorded both), plus a stall list: open
// rows that have not moved in a while. Time-in-stage is descriptive, not a
// conversion verdict, so it reads at a small sample (velocity_min_sample); the
// bottleneck arrows in `metrics` keep the strict RULES §6 sample gate.
function computeVelocity(doc, baselines) {
  const entries = (doc.entries || []).filter((e) => e && e.id);
  const readableMin = baselines.velocity_min_sample ?? 3;
  const stallDays = baselines.stall_days ?? 21;

  const arrows = {};
  for (const [key, from, to] of VELOCITY_ARROWS) {
    const spans = entries
      .filter((e) => dateOf(e, from) && dateOf(e, to))
      .map((e) => daysBetween(dateOf(e, from), dateOf(e, to)))
      .filter((d) => d >= 0);
    arrows[key] = { median_days: spans.length >= readableMin ? median(spans) : null, n: spans.length };
  }

  const t = today();
  const stalls = entries
    .filter((e) => !e.closed && idx(e.stage) >= idx('applied') && idx(e.stage) < idx('offer'))
    .map((e) => { const last = latestEventDate(e); return last ? { id: e.id, company: e.company, role: e.role, stage: e.stage, days_idle: daysBetween(last, t) } : null; })
    .filter((s) => s && s.days_idle >= stallDays)
    .sort((a, b) => b.days_idle - a.days_idle);

  return { arrows, stalls, stall_days: stallDays, readable_min: readableMin };
}

function renderVelocity(r) {
  const labels = {
    app_to_response: 'applied → response', response_to_screen: 'response → screen',
    screen_to_loop: 'screen → loop', loop_to_offer: 'loop → offer',
  };
  const L = ['Time-in-stage — median days between events (cumulative):'];
  for (const [key, label] of Object.entries(labels)) {
    const d = r.arrows[key];
    const val = d.median_days == null ? `—    (n=${d.n}${d.n ? ', too few to read' : ''})` : `${d.median_days}d   (n=${d.n})`;
    L.push(`  ${label.padEnd(20)} ${val}`);
  }
  L.push('');
  if (!r.stalls.length) L.push(`No stalls — nothing open has sat still for ${r.stall_days}+ days.`);
  else {
    L.push(`Stalled — open, no movement in ${r.stall_days}+ days (a nudge to follow up, not a verdict):`);
    for (const s of r.stalls) L.push(`  ${s.stage.padEnd(8)} ${String(s.days_idle).padStart(4)}d  ${s.company} · ${s.role}  (${s.id})`);
  }
  return L.join('\n');
}

function cmdVelocity(args) {
  const file = args.flags.file || join(ROOT, 'data/pipeline.yaml');
  const doc = loadYaml(file, { missingCode: 3 });

  const structural = validateStructure(doc);
  if (structural.length) {
    process.stderr.write('Refusing to show velocity: the pipeline data is invalid.\n');
    structural.forEach((e) => process.stderr.write(`ERROR ${e}\n`));
    process.stderr.write('\nRun /fh validate and fix these first.\n');
    process.exit(1);
  }

  const r = computeVelocity(doc, loadBaselines());
  if (args.flags.json) process.stdout.write(JSON.stringify(r, null, 2) + '\n');
  else process.stdout.write(renderVelocity(r) + '\n');
  process.exit(0);
}

// ---------- migrate (legacy dates{} map -> history[] event log) ----------

// Convert any entry still using the old `dates: {stage: date}` map into the ordered
// `history: [{stage, date}]` list. Idempotent: entries already on `history` are left as-is.
function migrateDoc(doc) {
  let changed = false;
  const entries = (doc && Array.isArray(doc.entries) ? doc.entries : []).map((e) => {
    if (!e || typeof e !== 'object' || Array.isArray(e.history) || !e.dates || typeof e.dates !== 'object') return e;
    const history = STAGES.filter((s) => e.dates[s]).map((s) => ({ stage: s, date: e.dates[s] }));
    const { dates: _drop, ...rest } = e;
    changed = true;
    return { ...rest, history };
  });
  return { changed, doc: { ...doc, entries } };
}

function cmdMigrate(args) {
  const file = args.flags.file || join(ROOT, 'data/pipeline.yaml');
  const doc = loadYaml(file, { missingCode: 3 });
  const { changed, doc: migrated } = migrateDoc(doc);
  if (!changed) { process.stdout.write('Already on the history model (nothing to migrate).\n'); process.exit(0); }
  const out = stringify(migrated);
  if (!args.flags.write) {
    process.stdout.write(out);
    process.stderr.write('\n(dry run — re-run with --write to save; the original is backed up to <file>.bak. Comments are not preserved.)\n');
    process.exit(0);
  }
  writeFileSync(file + '.bak', readFileSync(file, 'utf8'));
  writeFileSync(file, out);
  process.stdout.write(`Migrated ${file} to the history model. Backup at ${file}.bak. Now run /fh validate.\n`);
  process.exit(0);
}

// ---------- entry ----------

const args = parseArgs(process.argv.slice(2));
const cmd = args._[0];
if (cmd === 'validate') cmdValidate(args);
else if (cmd === 'metrics') cmdMetrics(args);
else if (cmd === 'interviews') cmdInterviews(args);
else if (cmd === 'trends') cmdTrends(args);
else if (cmd === 'velocity') cmdVelocity(args);
else if (cmd === 'migrate') cmdMigrate(args);
else die(2, `Usage: pipeline.mjs <validate|metrics|interviews|trends|velocity|migrate> [--file <path>] [--json]\n  validate   [--accept-corrections] [--state <path>]\n  metrics    [--week YYYY-Www]\n  interviews  the live screens + loops (informs /fh loop; reads only, never gates)\n  trends     [--max-weeks N]  the funnel arrows, cumulative as of each past week (informs /fh review)\n  velocity   time-in-stage medians + stalled open rows (informs /fh review)\n  migrate    [--write]  convert a legacy dates{} map to the history[] event log`);
