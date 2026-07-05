#!/usr/bin/env node
// leads.mjs — turn a batch of found job URLs into honest, deduped, id-assigned
// candidate lead rows. One subcommand: `ingest`. It normalizes each pasted URL,
// defaults the channel from the host, guesses company/role (always flagged to
// confirm), assigns a unique id, and flags anything already in the tracker.
//
// It PREPARES tracking; it never decides which jobs deserve an application (that
// is your positioning statement) and it never writes — the confirmed rows go out
// through core/commands/log.md's diff -> write -> validate ritual. Reads the
// tracker only to dedup and to avoid id collisions. yaml-tier: no browser, no
// network (any fetch lives in the playbook, never here). See core/RULES.md,
// core/SCHEMA.md, and core/commands/leads.md.

import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

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

function loadYaml(path, { missingCode } = {}) {
  if (!existsSync(path)) {
    if (missingCode) die(missingCode, `Missing file: ${path}`);
    return null;
  }
  try {
    return parse(readFileSync(path, 'utf8'));
  } catch (e) {
    die(3, `Could not parse ${path}: ${e.message}`);
  }
}

// ---------- host -> channel ----------

// Aggregators, job boards, and portals. A lead arriving through one of these is
// the cold-portal (volume) channel by definition:
// low conversion, but you can't guess the employer from the host either.
const AGGREGATORS = [
  'linkedin', 'naukri', 'instahyre', 'cutshort', 'wellfound', 'angel',
  'indeed', 'foundit', 'monster', 'hirist', 'glassdoor', 'shine',
  'iimjobs', 'timesjobs', 'simplyhired', 'ziprecruiter', 'dice',
  'workatastartup', 'ycombinator',
];

// Subdomains and TLD-ish parts to strip when guessing a company name from a host.
const HOST_NOISE = new Set([
  'www', 'careers', 'career', 'jobs', 'job', 'apply', 'boards', 'board',
  'recruiting', 'recruit', 'hire', 'hiring', 'talent', 'work', 'en', 'in',
]);
const CCSLD = new Set(['co', 'com', 'net', 'org', 'gov', 'ac', 'edu']);

// Path segments that are board scaffolding, not a role slug (e.g. linkedin's
// /jobs/view/<id>). Skipped when guessing a role from the URL path.
const PATH_NOISE = new Set([
  'jobs', 'job', 'view', 'careers', 'career', 'positions', 'position',
  'opening', 'openings', 'apply', 'detail', 'details', 'listing', 'listings',
  'posting', 'postings', 'role', 'roles', 'en', 'in', 'p',
]);

const isAggregator = (host) => AGGREGATORS.some((a) => host.includes(a));

function registrableName(host) {
  let parts = host.toLowerCase().split('.').filter(Boolean);
  parts = parts.filter((p) => !HOST_NOISE.has(p));
  if (parts.length > 1) parts = parts.slice(0, -1);           // drop TLD
  if (parts.length > 1 && CCSLD.has(parts[parts.length - 1])) // drop leftover co/com in co.in
    parts = parts.slice(0, -1);
  return parts[parts.length - 1] || '';
}

// ---------- text helpers ----------

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const titleCase = (s) => String(s).trim().split(/\s+/).filter(Boolean)
  .map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');

// Normalize a URL for duplicate detection: drop protocol, leading www., the
// fragment, and any trailing slash; lowercase. Keeps the query (it can identify
// the posting), so this errs toward NOT merging two genuinely different links.
function normalizeLink(url) {
  try {
    const u = new URL(url);
    const host = u.host.replace(/^www\./, '');
    let path = u.pathname.replace(/\/+$/, '');
    return (host + path + u.search).toLowerCase();
  } catch {
    return String(url).trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/+$/, '');
  }
}

// Best-effort role guess from the last meaningful path segment. Returns '' when
// the tail is just a numeric id (e.g. linkedin /jobs/view/123) — nothing honest
// to guess there.
function roleFromPath(pathname) {
  const segs = pathname.split('/').filter(Boolean);
  for (let i = segs.length - 1; i >= 0; i--) {
    const seg = segs[i];
    if (!/[a-z]/i.test(seg)) continue;                       // skip pure-id segments
    if (PATH_NOISE.has(seg.toLowerCase())) continue;         // skip board scaffolding
    const cleaned = seg.replace(/[-_]+/g, ' ').replace(/\b\d{4,}\b/g, '').trim();
    if (/[a-z]/i.test(cleaned)) return titleCase(cleaned);
  }
  return '';
}

const trailingDigits = (pathname) => {
  const m = pathname.match(/(\d{2,})(?!.*\d)/);
  return m ? m[1] : '';
};

// ---------- ingest ----------

function firstUrl(text) {
  const m = String(text).match(/https?:\/\/\S+/i);
  return m ? m[0].replace(/[),.]+$/, '') : '';
}

function parseInput(args) {
  // --urls: bare comma-separated URLs, no annotations. --file: one lead per line,
  // "url | company | role", with # comments and blank lines ignored.
  if (typeof args.flags.urls === 'string') {
    return args.flags.urls.split(',').map((u) => u.trim()).filter(Boolean);
  }
  if (args.flags.file) {
    const p = resolve(args.flags.file);
    if (!existsSync(p)) die(3, `Missing --file: ${p}`);
    return readFileSync(p, 'utf8').split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'));
  }
  die(2, 'ingest needs --urls "u1,u2,…" or --file <path>.');
}

function loadTracker(args) {
  // Explicit --pipeline that is missing/unparseable is an error (exit 3). A
  // missing DEFAULT tracker just means "fresh user": dedup and id-collision are
  // skipped and we say so, rather than failing.
  if (args.flags.pipeline) {
    const doc = loadYaml(resolve(String(args.flags.pipeline)), { missingCode: 3 });
    return { entries: (doc && doc.entries) || [], note: null };
  }
  const def = join(ROOT, 'data/pipeline.yaml');
  if (!existsSync(def)) return { entries: [], note: 'no tracker found — dedup and id-collision skipped' };
  const doc = loadYaml(def);
  return { entries: (doc && doc.entries) || [], note: null };
}

function cmdIngest(args) {
  const lines = parseInput(args);
  const { entries, note } = loadTracker(args);

  const existingLinks = new Map();  // normalized link -> entry id
  const usedIds = new Set();
  for (const e of entries) {
    if (e && e.id) usedIds.add(e.id);
    if (e && e.link) existingLinks.set(normalizeLink(e.link), e.id);
  }

  const uniqueId = (base) => {
    let id = base || 'lead';
    let n = 2;
    while (usedIds.has(id)) id = `${base || 'lead'}-${n++}`;
    usedIds.add(id);
    return id;
  };

  const rows = [];
  const duplicates = [];
  const rejected = [];

  for (const line of lines) {
    const segs = line.split('|').map((s) => s.trim());
    const url = firstUrl(segs[0]);
    if (!url) { rejected.push({ line, reason: 'no-link' }); continue; }

    const norm = normalizeLink(url);
    if (existingLinks.has(norm)) {
      duplicates.push({ line, link: url, existing_id: existingLinks.get(norm) });
      continue;
    }

    let host = '', pathname = '';
    try { const u = new URL(url); host = u.host; pathname = u.pathname; } catch { /* keep empty */ }

    const flags = [];
    const aggregator = isAggregator(host);
    const channel = 'cold-portal';
    flags.push(aggregator ? 'channel-inferred' : 'channel-assumed');

    // company
    let company = segs[1] || '';
    if (!company) {
      if (aggregator) { flags.push('company-missing'); }
      else {
        const reg = registrableName(host);
        if (reg) { company = titleCase(reg); flags.push('company-guessed'); }
        else flags.push('company-missing');
      }
    }

    // role
    let role = segs[2] || '';
    if (!role) {
      const guessed = roleFromPath(pathname);
      if (guessed) { role = guessed; flags.push('role-guessed'); }
      else flags.push('role-missing');
    }

    // id
    let base;
    if (company && role) base = `${slug(company)}-${slug(role.split(/\s+/).slice(0, 3).join(' '))}`;
    else if (company) base = slug(company);
    else if (role) base = slug(role);
    else base = [slug(registrableName(host) || host), trailingDigits(pathname)].filter(Boolean).join('-');
    base = base.replace(/^-+|-+$/g, '') || 'lead';

    const row = { id: uniqueId(base), company, role, link: url, channel, stage: 'lead', closed: false, flags };
    rows.push(row);
    existingLinks.set(norm, row.id); // catch a repeat of the same URL later in this batch
  }

  const report = { count: rows.length, ...(note ? { note } : {}), rows, duplicates, rejected };
  if (args.flags.json) { process.stdout.write(JSON.stringify(report, null, 2) + '\n'); process.exit(0); }

  renderReport(report);
  process.exit(0);
}

function renderRow(r) {
  const q = (v) => (v === '' ? '""' : v);
  const lines = [
    `  - id: ${r.id}`,
    `    company: ${q(r.company)}`,
    `    role: ${q(r.role)}`,
    `    link: ${r.link}`,
    `    channel: ${r.channel}`,
    `    stage: ${r.stage}`,
    `    closed: ${r.closed}`,
  ];
  if (r.flags.length) lines.push(`    # confirm: ${r.flags.join(', ')}`);
  return lines.join('\n');
}

function renderReport(report) {
  const out = [];
  if (report.note) out.push(`Note: ${report.note}.\n`);
  if (report.count) {
    out.push(`Ingested ${report.count} candidate lead row(s). Confirm each (fix any guessed field, set the true`);
    out.push(`channel), then write them via /fh log — this file never writes to the tracker.\n`);
    out.push('# --- candidate leads ---');
    out.push(report.rows.map(renderRow).join('\n'));
    out.push('');
  } else {
    out.push('No new candidate leads.\n');
  }
  if (report.duplicates.length) {
    out.push(`Already in your tracker (not re-added — a lead is not counted twice):`);
    for (const d of report.duplicates) out.push(`  - ${d.link}  ->  ${d.existing_id}`);
    out.push('');
  }
  if (report.rejected.length) {
    out.push(`Skipped (no link — "a lead IS a URL"):`);
    for (const r of report.rejected) out.push(`  - ${r.line}`);
    out.push('');
  }
  out.push('These INFORM; nothing here is written until you confirm and log. Positioning is the filter for');
  out.push('which of these deserve an application — drop the mis-targeted ones.');
  process.stdout.write(out.join('\n') + '\n');
}

// ---------- entry ----------

const args = parseArgs(process.argv.slice(2));
const cmd = args._[0];
if (cmd === 'ingest') cmdIngest(args);
else die(2, `Usage: leads.mjs ingest (--file <path> | --urls "u1,u2,…") [--pipeline <path>] [--json]
  ingest   turn pasted job URLs into deduped, id-assigned candidate lead rows
           (informs and prepares, never gates or writes — confirm, then log)`);
