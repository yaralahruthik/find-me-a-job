#!/usr/bin/env node
// resume.mjs — turns config/resume.yaml (the master career record) into a
// tailored, ATS-friendly resume. The master is unbounded; every build is a selection.
// Three subcommands: `validate` (structure gate), `lint` (deterministic proof
// checks that INFORM, never gate), `build` (render one self-contained HTML per
// segment; optional Playwright PDF). The agent does the coaching prose; this file
// does the mechanical, repeatable parts. See core/RULES.md and core/commands/resume.md.
//
// pipeline.mjs stays the only thing that computes funnel numbers. This file never
// imports it, and validate/metrics never import this — the browser dependency is
// isolated here so the core tracker installs and runs with `yaml` alone.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

const MONTH_RE = /^\d{4}-\d{2}$/;        // YYYY-MM (resume dates are month-granular)
const DASH_RE = /[—–]/;                  // em dash / en dash — flagged by lint, normalized at render
const PAGE_FORMATS = { letter: 'Letter', a4: 'A4' };

// Renderable sections, in default order. `section_order:` in resume.yaml may
// reorder them (e.g. a fresh grad putting education first); sections it omits
// keep this relative order after the listed ones. Summary renders only if present.
const SECTION_NAMES = ['summary', 'experience', 'projects', 'skills', 'education'];

// Bullets that start with one of these read as duties, not evidence. Flagged by lint.
const DUTY_OPENERS = new Set([
  'responsible', 'worked', 'helped', 'assisted', 'involved', 'participated',
  'handled', 'tasked', 'duties', 'various', 'contributed', 'supported',
]);

// core/RESUME-RULES.md §4: resumes are written in implied first person, and a
// claimed trait ("team player") is what weak resumes do instead of proving it.
const PRONOUN_RE = /\b(i|me|my|we|our)\b/i;
const BUZZWORDS = [
  'team player', 'detail-oriented', 'detail oriented', 'hard-working', 'hardworking',
  'results-driven', 'results driven', 'critical thinker', 'go-getter', 'self-starter',
  'passionate', 'synergy', 'think outside the box', 'dynamic', 'motivated',
];
const REFERENCES_RE = /references\s+(available\s+)?(up)?on\s+request|^references$/im;
const findBuzzword = (s) => BUZZWORDS.find((w) => new RegExp(`\\b${w.replace(/[-\s]/g, '[-\\s]')}\\b`, 'i').test(s));

// Months between two YYYY-MM values (positive when b is after a).
const monthsBetween = (a, b) => {
  const [ay, am] = a.split('-').map(Number); const [by, bm] = b.split('-').map(Number);
  return (by - ay) * 12 + (bm - am);
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
    if (missingCode) die(missingCode, `Missing file: ${path}\nRun /fh proof (or /fh init) to build your resume.yaml first.`);
    return null;
  }
  try {
    return parse(readFileSync(path, 'utf8'));
  } catch (e) {
    die(3, `Could not parse ${path}: ${e.message}`);
  }
}

function resumePath(args) {
  return args.flags.file ? resolve(args.flags.file) : join(ROOT, 'config/resume.yaml');
}

// A segment spec is a string ("product") or a comma list ("product,backend") or a
// YAML list. Normalises to a lowercased array; empty means "unspecified".
function parseSegments(v) {
  if (Array.isArray(v)) return v.map((s) => String(s).toLowerCase().trim()).filter(Boolean);
  if (typeof v === 'string') return v.split(',').map((s) => s.toLowerCase().trim()).filter(Boolean);
  return [];
}

// Resolve the framing (which segments + which headline) for a build/lint. Precedence,
// highest first: explicit --segment / --role; the overlay's segment / role; the profile
// default. A role preset (config/resume.yaml `roles:`) bundles a headline + segment set —
// e.g. the same person framed as "Product Engineer" or "Full-Stack Engineer". An explicit
// segment overrides a role's set; an overlay headline overrides a role's headline.
function resolveFraming(args, overlay, doc) {
  const roleName = args.flags.role ? String(args.flags.role) : (overlay.role ? String(overlay.role) : null);
  let segs = null;
  let headline = doc.headline;
  if (roleName) {
    const preset = doc.roles && doc.roles[roleName];
    if (!preset) die(2, `Unknown role "${roleName}". Define it under roles: in config/resume.yaml, or drop --role.`);
    segs = parseSegments(preset.segments);
    if (isNonEmptyString(preset.headline)) headline = preset.headline;
  }
  const segFlag = args.flags.segment ? parseSegments(args.flags.segment)
    : (overlay.segment !== undefined ? parseSegments(overlay.segment) : null);
  if (segFlag && segFlag.length) segs = segFlag;
  if (!segs || !segs.length) {
    const p = loadYaml(join(ROOT, 'config/profile.yaml')) || loadYaml(join(ROOT, 'config/profile.example.yaml'));
    segs = [(p && p.target_segment) ? String(p.target_segment).toLowerCase() : 'all'];
  }
  if (isNonEmptyString(overlay.headline)) headline = overlay.headline;
  return { segSet: new Set(segs), segLabel: segs.join('+'), headline, role: roleName };
}

// Every bullet id declared anywhere in the master. Overlays may only reference these.
function collectBulletIds(doc) {
  const ids = new Set();
  for (const item of [...(doc.experience || []), ...(doc.projects || [])])
    for (const b of item.bullets || []) if (b && typeof b === 'object' && b.id) ids.add(b.id);
  return ids;
}

// ---------- validation ----------

function isNonEmptyString(v) { return typeof v === 'string' && v.trim() !== ''; }
function validMonth(v) { return v === 'present' || (typeof v === 'string' && MONTH_RE.test(v)); }

function validateResume(doc) {
  const errors = [];
  if (doc === null || typeof doc !== 'object' || Array.isArray(doc)) return ['file is empty or not a mapping'];
  if (!isNonEmptyString(doc.name)) errors.push('missing required field "name"');

  const bulletIds = new Map();   // id -> first location; enforces uniqueness so overlays resolve
  const checkBullets = (bullets, where) => {
    if (bullets === undefined) return;
    if (!Array.isArray(bullets)) { errors.push(`${where}: "bullets" must be a list`); return; }
    bullets.forEach((b, i) => {
      const at = `${where} bullet #${i + 1}`;
      if (b && typeof b === 'object' && !Array.isArray(b)) {
        if (!isNonEmptyString(b.text)) errors.push(`${at}: missing "text"`);
        if (b.segments !== undefined) {
          if (!Array.isArray(b.segments)) errors.push(`${at}: "segments" must be a list of strings`);
          else if (!b.segments.every(isNonEmptyString)) errors.push(`${at}: "segments" must be non-empty strings`);
          else {
            // `archive` keeps a bullet in the master record without shipping it.
            // Mixed tags would silently resurface it in the other segments' builds.
            const tags = b.segments.map((s) => String(s).toLowerCase());
            if (tags.includes('archive') && tags.length > 1)
              errors.push(`${at}: "archive" is exclusive — an archived bullet cannot carry other segment tags (${b.segments.join(', ')}). Drop the others, or un-archive it.`);
          }
        }
        if (b.id !== undefined) {
          if (!isNonEmptyString(b.id)) errors.push(`${at}: "id" must be a non-empty string`);
          else if (bulletIds.has(b.id)) errors.push(`${at}: duplicate bullet id "${b.id}" (also on ${bulletIds.get(b.id)}) — ids must be unique so overlays resolve unambiguously`);
          else bulletIds.set(b.id, at);
        }
      } else {
        errors.push(`${at}: must be a mapping with a "text" field`);
      }
    });
  };

  if (doc.experience !== undefined) {
    if (!Array.isArray(doc.experience)) errors.push('"experience" must be a list');
    else doc.experience.forEach((e, i) => {
      const where = e && e.company ? `experience "${e.company}"` : `experience #${i + 1}`;
      if (!e || typeof e !== 'object' || Array.isArray(e)) { errors.push(`${where}: not a mapping`); return; }
      if (!isNonEmptyString(e.company)) errors.push(`${where}: missing "company"`);
      if (!isNonEmptyString(e.role)) errors.push(`${where}: missing "role"`);
      if (e.start !== undefined && !validMonth(e.start)) errors.push(`${where}: "start" must be YYYY-MM`);
      if (e.end !== undefined && !validMonth(e.end)) errors.push(`${where}: "end" must be YYYY-MM or "present"`);
      checkBullets(e.bullets, where);
    });
  }

  if (doc.projects !== undefined) {
    if (!Array.isArray(doc.projects)) errors.push('"projects" must be a list');
    else doc.projects.forEach((p, i) => {
      const where = p && p.name ? `project "${p.name}"` : `project #${i + 1}`;
      if (!p || typeof p !== 'object' || Array.isArray(p)) { errors.push(`${where}: not a mapping`); return; }
      if (!isNonEmptyString(p.name)) errors.push(`${where}: missing "name"`);
      checkBullets(p.bullets, where);
    });
  }

  if (doc.skills !== undefined) {
    if (!Array.isArray(doc.skills)) errors.push('"skills" must be a list');
    else doc.skills.forEach((s, i) => {
      const where = s && s.group ? `skills "${s.group}"` : `skills #${i + 1}`;
      if (!s || typeof s !== 'object' || Array.isArray(s)) { errors.push(`${where}: not a mapping`); return; }
      if (!isNonEmptyString(s.group)) errors.push(`${where}: missing "group"`);
      if (!Array.isArray(s.items) || !s.items.length) errors.push(`${where}: "items" must be a non-empty list`);
    });
  }

  if (doc.links !== undefined) {
    if (!Array.isArray(doc.links)) errors.push('"links" must be a list');
    else doc.links.forEach((l, i) => {
      if (!l || typeof l !== 'object' || !isNonEmptyString(l.url)) errors.push(`link #${i + 1}: missing "url"`);
    });
  }

  if (doc.roles !== undefined) {
    if (typeof doc.roles !== 'object' || Array.isArray(doc.roles)) errors.push('"roles" must be a mapping of name -> { headline, segments }');
    else for (const [name, preset] of Object.entries(doc.roles)) {
      const where = `role "${name}"`;
      if (!preset || typeof preset !== 'object' || Array.isArray(preset)) { errors.push(`${where}: not a mapping`); continue; }
      if (preset.headline !== undefined && !isNonEmptyString(preset.headline)) errors.push(`${where}: "headline" must be a non-empty string`);
      if (!Array.isArray(preset.segments) || !preset.segments.length || !preset.segments.every(isNonEmptyString))
        errors.push(`${where}: "segments" must be a non-empty list of strings`);
    }
  }

  if (doc.section_order !== undefined) {
    if (!Array.isArray(doc.section_order)) errors.push(`"section_order" must be a list drawn from: ${SECTION_NAMES.join(', ')}`);
    else {
      const seen = new Set();
      doc.section_order.forEach((s, i) => {
        if (!SECTION_NAMES.includes(s)) errors.push(`section_order #${i + 1}: unknown section "${s}" (valid: ${SECTION_NAMES.join(', ')})`);
        else if (seen.has(s)) errors.push(`section_order #${i + 1}: duplicate section "${s}"`);
        else seen.add(s);
      });
    }
  }

  return errors;
}

// ---------- per-application overlays (selection-only) ----------

// An overlay tailors the master for one application. It may ONLY select, reorder,
// and re-headline — never introduce content. Every bullet it names must already
// exist in the master, which makes per-JD fabrication structurally impossible.
const OVERLAY_KEYS = new Set(['version', 'entry', 'role', 'segment', 'headline', 'summary', 'pin', 'drop', 'include']);

function validateOverlay(ov, masterIds) {
  const errors = [];
  if (ov === null || typeof ov !== 'object' || Array.isArray(ov)) return ['overlay is empty or not a mapping'];
  for (const k of Object.keys(ov)) {
    if (OVERLAY_KEYS.has(k)) continue;
    if (['bullets', 'text', 'experience', 'projects', 'skills'].includes(k))
      errors.push(`overlay key "${k}" is not allowed — overlays only select from the master. If a bullet is real, add it to config/resume.yaml (the one audited source).`);
    else errors.push(`overlay has unknown key "${k}"`);
  }
  if (ov.role !== undefined && !isNonEmptyString(ov.role)) errors.push('overlay "role" must be a non-empty string (a name under roles: in config/resume.yaml)');
  if (ov.segment !== undefined && !(isNonEmptyString(ov.segment) || (Array.isArray(ov.segment) && ov.segment.length && ov.segment.every(isNonEmptyString))))
    errors.push('overlay "segment" must be a non-empty string or list of strings');
  if (ov.headline !== undefined && !isNonEmptyString(ov.headline)) errors.push('overlay "headline" must be a non-empty string');
  if (ov.summary !== undefined && ov.summary !== false && !isNonEmptyString(ov.summary)) errors.push('overlay "summary" must be a string, or false to hide it');
  for (const key of ['pin', 'drop', 'include']) {
    if (ov[key] === undefined) continue;
    if (!Array.isArray(ov[key])) { errors.push(`overlay "${key}" must be a list of bullet ids`); continue; }
    ov[key].forEach((id) => {
      if (!isNonEmptyString(id)) errors.push(`overlay "${key}" has a non-string entry`);
      else if (!masterIds.has(id)) errors.push(`overlay "${key}" references unknown bullet id "${id}" — every claim must exist in config/resume.yaml. Give the master bullet an id, or fix this one.`);
    });
  }
  return errors;
}

// Path-safe slug for any value that becomes a filename or path component. The
// entry-id/segment/role are synthesized by the agent from external job data, so
// a raw "../../x" must never reach join()/writeFileSync (core/RULES.md §9).
function safeSlug(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
}

// Load the overlay for --for <entry-id> (or --tailor-file <path> for tests).
// Returns { forId, overlay, note }. Exits 1 if the overlay is malformed. An
// absent overlay is fine — an application can be tailored by segment alone.
function resolveOverlay(args, doc) {
  // Slug the id so it can't traverse the tailor path or the output basename.
  const forId = args.flags.for ? safeSlug(args.flags.for) : null;
  if (!forId) return { forId: null, overlay: {}, note: null };
  const ovPath = args.flags['tailor-file'] ? resolve(args.flags['tailor-file']) : join(ROOT, 'config/tailor', `${forId}.yaml`);
  if (!existsSync(ovPath)) {
    return { forId, overlay: {}, note: `no overlay at ${ovPath} — building by segment only. Add one to pin/drop/re-headline for this application.` };
  }
  const overlay = loadYaml(ovPath) || {};
  const errs = validateOverlay(overlay, collectBulletIds(doc));
  if (errs.length) {
    process.stderr.write(`Overlay ${ovPath} is invalid:\n`);
    errs.forEach((e) => process.stderr.write(`ERROR ${e}\n`));
    process.exit(1);
  }
  return { forId, overlay, note: null };
}

// Soft check: is this application actually in the tracker? true / false / null (unknown).
function pipelineHasEntry(id) {
  const doc = loadYaml(join(ROOT, 'data/pipeline.yaml'));
  if (!doc || !Array.isArray(doc.entries)) return null;
  return doc.entries.some((e) => e && e.id === id);
}

// ---------- segment + overlay selection ----------

// A bullet is included when it has no tags (always-on) or any of its tags is in the
// requested segment set. An "all" set includes everything. `archive` is a reserved
// convention tag (exclusive, enforced by validate): by construction an archived
// bullet is excluded from every concrete framing, visible under `all` (the master
// career record view), and resurrectable per-application via overlay `include:`.
function bulletIncluded(bullet, segSet) {
  if (segSet.has('all')) return true;
  const tags = Array.isArray(bullet.segments) ? bullet.segments.map((s) => String(s).toLowerCase()) : [];
  return tags.length === 0 || tags.some((t) => segSet.has(t));
}

// Overlay applied on top of segment selection: `drop` hides, `include` force-adds
// (still from the master), `pin` floats bullets to the top of their own section.
// Headline is resolved by resolveFraming; here we only handle summary + bullets.
function selectForSegment(doc, segSet, overlay = {}) {
  const drop = new Set(overlay.drop || []);
  const include = new Set(overlay.include || []);
  const pinRank = new Map((overlay.pin || []).map((id, i) => [id, i]));

  const pick = (bullets) => {
    if (!Array.isArray(bullets)) return [];
    const kept = bullets.filter((b) => {
      const id = b && b.id;
      if (id && drop.has(id)) return false;
      if (id && include.has(id)) return true;
      return bulletIncluded(b, segSet);
    });
    // stable: pinned first (in pin order), everything else keeps authored order
    return kept
      .map((b, i) => ({ b, i, rank: b && b.id && pinRank.has(b.id) ? pinRank.get(b.id) : Infinity }))
      .sort((x, y) => (x.rank !== y.rank ? x.rank - y.rank : x.i - y.i))
      .map((o) => o.b);
  };

  const out = {
    ...doc,
    experience: (doc.experience || []).map((e) => ({ ...e, bullets: pick(e.bullets) })),
    projects: (doc.projects || []).map((p) => ({ ...p, bullets: pick(p.bullets) })),
  };
  if (overlay.summary !== undefined) out.summary = overlay.summary === false ? undefined : overlay.summary;
  return out;
}

// ---------- lint (informs, never gates) ----------

function wordCount(s) { return s.trim().split(/\s+/).length; }
const hasDigit = (s) => /\d/.test(s);

// One-page estimate, tied to the render CSS (11pt serif, 1.25 line-height,
// Letter with ~13mm margins): the page holds ~52 text lines at ~90 chars each.
// Experience/education headings are two rows (role/dates + company/location),
// projects one; +1 spacing per item either way.
const HEADER_LINES = 6;      // name + headline + contact + surrounding space
const CHARS_PER_LINE = 90;
const ONE_PAGE_LINES = 52;

function lintResume(doc, segSet, segLabel, overlay = {}) {
  const flags = [];
  const add = (severity, where, msg) => flags.push({ severity, where, msg });

  if (!isNonEmptyString(doc.headline)) add('warn', 'header', 'no headline; add your positioning line at the top (recruiters read it first).');
  if (!isNonEmptyString(doc.email)) add('warn', 'header', 'no email; a resume with no contact route is a dead end.');
  if (DASH_RE.test(doc.headline || '')) add('style', 'header', 'headline contains an em/en dash; use a comma, colon, or hyphen instead.');
  if (DASH_RE.test(doc.summary || '')) add('style', 'summary', 'summary contains an em/en dash; use a comma, colon, or hyphen instead.');

  // core/RESUME-RULES.md §6.5: contact hygiene. Inform-only, like everything here.
  if (!isNonEmptyString(doc.phone)) add('contact', 'header', 'no phone; recruiters still call, and a missing contact route is a Harvard top-5 mistake.');
  if (isNonEmptyString(doc.email) && isNonEmptyString(doc.name)) {
    const local = doc.email.split('@')[0].toLowerCase().replace(/[^a-z]/g, '');
    const nameTokens = doc.name.toLowerCase().split(/\s+/).map((t) => t.replace(/[^a-z]/g, '')).filter((t) => t.length >= 3);
    if (nameTokens.length && !nameTokens.some((t) => local.includes(t) || t.includes(local)))
      add('contact', 'header', `email "${doc.email}" does not look name-based; a professional address derived from your name reads better to recruiters.`);
  }
  for (const [where, text] of [['header', doc.headline || ''], ['summary', doc.summary || '']]) {
    if (PRONOUN_RE.test(text)) add('pronoun', where, 'contains a first-person pronoun (I/me/my/we/our); resumes are written in implied first person.');
    const bw = findBuzzword(text);
    if (bw) add('buzzword', where, `contains "${bw}"; show the trait through an achievement instead of claiming it.`);
  }
  if (REFERENCES_RE.test(doc.summary || '')) add('references', 'summary', 'drop "references available upon request"; it buys nothing and costs a line.');

  let lineEstimate = HEADER_LINES;
  const scan = (items, kind) => {
    for (const item of items || []) {
      const label = item.company || item.name || kind;
      lineEstimate += kind === 'experience' ? 3 : 2; // heading rows + spacing
      for (const b of item.bullets || []) {
        const text = typeof b.text === 'string' ? b.text : '';
        lineEstimate += Math.max(1, Math.ceil(text.length / CHARS_PER_LINE));
        // Only the `all` (master) view sees archived bullets; an id-less one can
        // never be resurrected by an overlay include, so flag it here.
        const tags = Array.isArray(b.segments) ? b.segments.map((s) => String(s).toLowerCase()) : [];
        if (segSet.has('all') && tags.includes('archive') && !b.id)
          add('warn', label, `"${text.slice(0, 50)}…" is archived but has no id; give it one so a per-application overlay can resurrect it with include:.`);
        const first = text.trim().split(/\s+/)[0]?.toLowerCase().replace(/[^a-z]/g, '') || '';
        if (DUTY_OPENERS.has(first)) add('duty', label, `"${text.slice(0, 60)}…" opens with "${first}", duty phrasing, not evidence. Lead with the outcome.`);
        if (!hasDigit(text)) add('metric', label, `"${text.slice(0, 60)}…" has no number; run the metric excavation, a real number was probably there.`);
        if (wordCount(text) > 32) add('length', label, `"${text.slice(0, 40)}…" is ${wordCount(text)} words; tighten to one measurable claim.`);
        if (DASH_RE.test(text)) add('style', label, `"${text.slice(0, 50)}…" contains an em/en dash; use a comma, colon, or hyphen.`);
        if (PRONOUN_RE.test(text)) add('pronoun', label, `"${text.slice(0, 50)}…" contains a first-person pronoun; resumes are written in implied first person.`);
        const bw = findBuzzword(text);
        if (bw) add('buzzword', label, `"${text.slice(0, 50)}…" contains "${bw}"; show the trait through an achievement instead of claiming it.`);
        if (REFERENCES_RE.test(text)) add('references', label, `"${text.slice(0, 50)}…" mentions references on request; the line buys nothing and costs a line.`);
      }
      // core/RESUME-RULES.md §2: 5-7 bullets per role at most, in a shipped framing.
      if (kind === 'experience' && !segSet.has('all') && (item.bullets || []).length > 7)
        add('bullets', label, `${item.bullets.length} bullets in this framing; past 7 the strongest ones dilute. Re-tag the weakest (archive, or a narrower segment).`);
    }
  };
  const selected = selectForSegment(doc, segSet, overlay);
  scan(selected.experience, 'experience');
  scan(selected.projects, 'projects');

  // core/RESUME-RULES.md §2/§6: reverse-chronological order, and gaps as a framing
  // conversation. Dates are structured (YYYY-MM | present), so these are exact.
  const exp = (doc.experience || []).filter((e) => e && validMonth(e.start));
  const startKey = (e) => (e.start === 'present' ? '9999-12' : e.start);
  for (let i = 0; i + 1 < exp.length; i++) {
    if (startKey(exp[i]) < startKey(exp[i + 1])) {
      add('order', 'document', `experience "${exp[i].company}" (${exp[i].start}) is listed above the more recent "${exp[i + 1].company}" (${exp[i + 1].start}); use reverse-chronological order.`);
      break;
    }
  }
  const years = (doc.education || []).map((e) => parseInt(String(e.year || ''), 10)).filter((y) => !Number.isNaN(y));
  if (years.some((y, i) => i > 0 && y > years[i - 1]))
    add('order', 'document', 'education entries are not in reverse-chronological order (newest first).');
  const byRecency = [...exp].sort((a, b) => (startKey(a) < startKey(b) ? 1 : -1));
  for (let i = 0; i + 1 < byRecency.length; i++) {
    const newer = byRecency[i], older = byRecency[i + 1];
    if (older.end && older.end !== 'present' && validMonth(older.end) && newer.start !== 'present') {
      const gap = monthsBetween(older.end, newer.start);
      if (gap > 6) add('gap', 'document', `${gap} months between "${older.company}" ending ${older.end} and "${newer.company}" starting ${newer.start}; decide the one-line framing before a recruiter wonders. A gap is a conversation, never a wall.`);
    }
  }

  // Agnostic nudge: projects mainly earn their space for early-career or extraordinary work.
  const expHas = (selected.experience || []).some((e) => (e.bullets || []).length);
  const projHas = (selected.projects || []).some((p) => (p.bullets || []).length);
  if (expHas && projHas) add('info', 'document', 'You have work experience and a Projects section. Projects mainly convert doubt for early-career or extraordinary work; if your experience carries you, consider cutting it for space.');

  if (lineEstimate > ONE_PAGE_LINES) {
    if (segSet.has('all')) add('info', 'document', `estimated ~${lineEstimate} lines for "all" — the master career record is allowed to run long; the one-page bar applies to the concrete framing you ship (lint with --segment/--role/--for).`);
    else add('length', 'document', `estimated ~${lineEstimate} lines for segment "${segLabel}"; likely over one page. Re-tag the weakest bullets (archive, or a narrower segment) — never delete a true one.`);
  }

  return { segment: segLabel, flags, line_estimate: lineEstimate };
}

// ---------- keyword coverage (informs, never gates) ----------

// The ATS-visible text of a rendered resume: headline, summary, every included
// bullet, skills, and each role/company. Normalized so matching sees what ships.
function extractResumeText(selected) {
  const parts = [];
  if (isNonEmptyString(selected.headline)) parts.push(selected.headline);
  if (isNonEmptyString(selected.summary)) parts.push(selected.summary);
  for (const e of selected.experience || []) {
    if (e.role) parts.push(e.role);
    if (e.company) parts.push(e.company);
    for (const b of e.bullets || []) if (b && b.text) parts.push(b.text);
  }
  for (const p of selected.projects || []) {
    if (p.name) parts.push(p.name);
    if (p.role) parts.push(p.role);
    for (const b of p.bullets || []) if (b && b.text) parts.push(b.text);
  }
  for (const s of selected.skills || []) {
    if (s.group) parts.push(s.group);
    if (Array.isArray(s.items)) parts.push(s.items.join(' '));
  }
  return normalizeText(parts.join(' \n '));
}

// Lowercase and collapse every non-alphanumeric run to a single space, padded so
// a whole-token search never matches inside a longer word ("react" != "reaction").
function normForMatch(s) { return ` ${String(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()} `; }

// Which keywords literally appear in the text, which don't. No score, no rate —
// present/missing are deterministic facts. Synonyms are the agent's job, not this.
function keywordCoverage(text, keywords) {
  const haystack = normForMatch(text);
  const present = [], missing = [];
  for (const kw of keywords) {
    const needle = normForMatch(kw);
    if (needle === ' ') continue;               // empty after normalizing
    (haystack.includes(needle) ? present : missing).push(kw);
  }
  return { present, missing };
}

// Where in the master a framing-missing keyword lives. Scans experience/project
// bullet text only — the sole framing-variable text (skills, company/role names,
// and the master headline are never segment-filtered, so a keyword there can't
// be missing). Returns location strings like `experience "Old Co." bullet #2 (id: k8s)`.
function findKeywordInMaster(doc, keyword) {
  const needle = normForMatch(keyword);
  const found = [];
  const scan = (items, kind) => {
    for (const item of items || []) {
      const label = `${kind} "${item.company || item.name || '?'}"`;
      (item.bullets || []).forEach((b, i) => {
        if (b && typeof b.text === 'string' && normForMatch(b.text).includes(needle))
          found.push(`${label} bullet #${i + 1}${b.id ? ` (id: ${b.id})` : ''}`);
      });
    }
  };
  scan(doc.experience, 'experience');
  scan(doc.projects, 'project');
  return found;
}

// --keywords "a,b,system design" (comma list) or --keywords-file <path> (comma
// or newline separated). Returns a de-duplicated, trimmed list.
function collectKeywords(args) {
  let raw = '';
  if (args.flags['keywords-file']) {
    const p = resolve(args.flags['keywords-file']);
    if (!existsSync(p)) die(3, `Missing --keywords-file: ${p}`);
    raw = readFileSync(p, 'utf8');
  } else if (typeof args.flags.keywords === 'string') {
    raw = args.flags.keywords;
  } else {
    die(2, 'coverage needs --keywords "react,graphql,…" (or --keywords-file <path>).');
  }
  const seen = new Set();
  return raw.split(/[,\n]/).map((s) => s.trim()).filter((s) => {
    if (!s || seen.has(s.toLowerCase())) return false;
    seen.add(s.toLowerCase());
    return true;
  });
}

// ---------- HTML rendering ----------

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Only http(s)/mailto URLs survive into an href — a javascript:/data: scheme in a
// resume.yaml `url` field becomes "#" rather than an active link. Escaping keeps a
// URL inside its attribute; this stops the scheme itself being dangerous.
function safeHref(url) {
  return /^(https?:|mailto:)/i.test(String(url).trim()) ? esc(url) : '#';
}

// Em/en dashes read as an AI tell and the user dislikes them. Em dash -> comma,
// en dash (ranges) -> hyphen. Applied to human-readable text only, never to URLs.
function normalizeText(s) {
  return String(s)
    .replace(/\s*—\s*/g, ', ')   // em dash -> comma
    .replace(/\s*–\s*/g, '-')    // en dash -> hyphen (numeric ranges)
    .replace(/\s+,/g, ',');      // tidy any stray space before a comma
}

// Escaped, dash-normalized text for display. Use esc() for attributes/URLs.
function txt(s) { return esc(normalizeText(s)); }

function fmtRange(start, end) {
  const f = (m) => (m === 'present' ? 'Present' : (typeof m === 'string' && MONTH_RE.test(m)
    ? new Date(m + '-01T00:00:00Z').toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' })
    : m));
  if (!start && !end) return '';
  return [start ? f(start) : '', end ? f(end) : ''].filter(Boolean).join(' - ');
}

function contactLine(doc) {
  const parts = [];
  if (doc.email) parts.push(esc(doc.email));
  if (doc.phone) parts.push(esc(doc.phone));
  if (doc.location) parts.push(txt(doc.location));
  for (const l of doc.links || []) parts.push(`<a href="${safeHref(l.url)}">${txt(l.label || l.url)}</a>`);
  return parts.join(' | ');
}

function renderSectionItems(items, kind) {
  const out = [];
  for (const item of items) {
    const bullets = item.bullets || [];
    if (kind === 'experience' && !bullets.length) continue; // tailored out entirely
    out.push('<div class="item">');
    if (kind === 'project') {
      const title = `${txt(item.name)}${item.url ? ` | <a href="${safeHref(item.url)}">${esc(String(item.url).replace(/^https?:\/\//, ''))}</a>` : ''}`;
      out.push(`  <div class="item-row"><span class="item-title">${title}</span><span class="item-sub">${item.role ? txt(item.role) : ''}</span></div>`);
    } else {
      // jakegut layout: bold role + dates right, then italic company + location right.
      out.push(`  <div class="item-row"><span class="item-title">${txt(item.role)}</span><span class="item-date">${fmtRange(item.start, item.end)}</span></div>`);
      out.push(`  <div class="item-row item-sub"><span>${txt(item.company)}</span><span>${item.location ? txt(item.location) : ''}</span></div>`);
    }
    if (bullets.length) {
      out.push('  <ul>');
      for (const b of bullets) out.push(`    <li>${txt(b.text)}</li>`);
      out.push('  </ul>');
    }
    out.push('</div>');
  }
  return out.join('\n');
}

function renderHtml(doc, segment, pageKey) {
  const format = PAGE_FORMATS[pageKey] || 'Letter';

  // One builder per section; each returns '' when it has nothing to render.
  const builders = {
    summary: () => (isNonEmptyString(doc.summary)
      ? `<section><h2>Summary</h2><p class="summary">${txt(doc.summary)}</p></section>` : ''),
    experience: () => ((doc.experience || []).some((e) => (e.bullets || []).length)
      ? `<section><h2>Experience</h2>\n${renderSectionItems(doc.experience || [], 'experience')}</section>` : ''),
    projects: () => {
      const rendered = renderSectionItems((doc.projects || []).filter((p) => (p.bullets || []).length), 'project');
      return rendered ? `<section><h2>Projects</h2>\n${rendered}</section>` : '';
    },
    skills: () => {
      if (!(doc.skills || []).length) return '';
      const rows = doc.skills.map((s) => `<div class="skill-row"><span class="skill-group">${txt(s.group)}:</span> <span class="skill-items">${txt((s.items || []).join(', '))}</span></div>`).join('\n');
      return `<section><h2>Skills</h2>\n${rows}</section>`;
    },
    education: () => {
      if (!(doc.education || []).length) return '';
      const rows = doc.education.map((e) => `<div class="item"><div class="item-row"><span class="item-title">${txt(e.school || '')}</span><span class="item-date">${txt(String(e.year || ''))}</span></div>${e.degree ? `<div class="item-row item-sub"><span>${txt(e.degree)}</span></div>` : ''}</div>`).join('\n');
      return `<section><h2>Education</h2>\n${rows}</section>`;
    },
  };
  const listed = Array.isArray(doc.section_order) ? doc.section_order : [];
  const order = [...listed, ...SECTION_NAMES.filter((s) => !listed.includes(s))];
  const sections = order.map((s) => builders[s]()).filter(Boolean);

  // Self-contained: one <style>, no external fonts/scripts/images (CSP- and ATS-safe).
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${txt(doc.name)} - Resume (${esc(segment)})</title>
<style>
  /* Classic-serif, jakegut/resume-style template: small-caps name and section
     headings with full-width rules, bold role + right-aligned dates, italic
     company/location row, tight one-page spacing. Charter is the best websafe
     Computer Modern stand-in (lining figures matter on a metrics-heavy resume);
     Times New Roman is the everywhere fallback. */
  @page { size: ${format}; margin: 13mm 15mm; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    font-family: Charter, 'Bitstream Charter', 'Times New Roman', serif;
    color: #000; font-size: 11pt; line-height: 1.25;
    max-width: 8in; margin: 0 auto; padding: 28px 36px;
  }
  header { text-align: center; margin-bottom: 8px; }
  h1 { font-size: 24pt; font-variant: small-caps; margin: 0; letter-spacing: .5px; font-weight: bold; }
  .headline { font-size: 10.5pt; font-weight: normal; margin: 1px 0 3px; }
  .contact { font-size: 10pt; }
  .contact a { color: inherit; text-decoration: underline; }
  h2 {
    font-size: 12pt; font-variant: small-caps; font-weight: normal; letter-spacing: .3px;
    border-bottom: 1px solid #000; padding-bottom: 1px; margin: 10px 0 4px;
  }
  .summary { margin: 0; }
  .item { margin: 0 0 6px; }
  .item-row { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; }
  .item-title { font-weight: bold; }
  .item-date { white-space: nowrap; }
  .item-sub { font-style: italic; font-size: 10pt; }
  ul { margin: 2px 0 0; padding-left: 16px; }
  li { margin: 0 0 1px; }
  li::marker { font-size: 8pt; }
  .skill-row { margin: 0 0 1px; }
  .skill-group { font-weight: bold; }
  a { color: inherit; }
  @media print { body { padding: 0; max-width: none; } }
</style>
</head>
<body>
<header>
  <h1>${txt(doc.name)}</h1>
  ${isNonEmptyString(doc.headline) ? `<p class="headline">${txt(doc.headline)}</p>` : ''}
  <div class="contact">${contactLine(doc)}</div>
</header>
${sections.join('\n')}
</body>
</html>
`;
}

// ---------- PDF (Playwright, isolated + graceful) ----------

async function renderPdf(html, outPath, pageKey) {
  let chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch {
    return { ok: false, reason: 'playwright is not installed. Run `npm install` then `npx playwright install chromium`.' };
  }
  let browser;
  try {
    browser = await chromium.launch();
    // The template is fully self-contained (inline CSS, no external refs). Disable
    // JS and abort every non-data: request so a crafted resume field can never turn
    // the render into an SSRF or a file:// read, even if HTML escaping ever regresses.
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    await page.route('**/*', (route) => {
      route.request().url().startsWith('data:') ? route.continue() : route.abort();
    });
    await page.setContent(html, { waitUntil: 'load' });
    await page.pdf({ path: outPath, format: PAGE_FORMATS[pageKey] || 'Letter', printBackground: true });
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: `Playwright could not render (browser not installed?): ${e.message}. Try \`npx playwright install chromium\`.` };
  } finally {
    if (browser) await browser.close();
  }
}

// ---------- commands ----------

function cmdValidate(args) {
  const file = resumePath(args);
  const doc = loadYaml(file, { missingCode: 3 });
  const errors = validateResume(doc);
  if (errors.length) {
    if (args.flags.json) process.stdout.write(JSON.stringify({ ok: false, errors }, null, 2) + '\n');
    else { errors.forEach((e) => process.stderr.write(`ERROR ${e}\n`)); process.stderr.write(`\n${errors.length} problem(s) in ${file}.\n`); }
    process.exit(1);
  }
  if (args.flags.json) process.stdout.write(JSON.stringify({ ok: true }, null, 2) + '\n');
  else process.stdout.write(`OK — ${file} is well-formed.\n`);
  process.exit(0);
}

function cmdLint(args) {
  const file = resumePath(args);
  const doc = loadYaml(file, { missingCode: 3 });
  const errors = validateResume(doc);
  if (errors.length) {
    process.stderr.write('Refusing to lint: resume.yaml is malformed. Run `resume.mjs validate` first.\n');
    errors.forEach((e) => process.stderr.write(`ERROR ${e}\n`));
    process.exit(1);
  }
  const { overlay } = resolveOverlay(args, doc);
  const { segSet, segLabel } = resolveFraming(args, overlay, doc);
  const report = lintResume(doc, segSet, segLabel, overlay);
  if (args.flags.json) { process.stdout.write(JSON.stringify(report, null, 2) + '\n'); process.exit(0); }

  if (!report.flags.length) {
    process.stdout.write(`No mechanical flags for segment "${segLabel}" (~${report.line_estimate} lines). Proof phrasing looks clean — the human read still matters.\n`);
    process.exit(0);
  }
  process.stdout.write(`Lint for segment "${segLabel}" — ${report.flags.length} flag(s). These INFORM; nothing here blocks a build.\n\n`);
  for (const f of report.flags) process.stdout.write(`  [${f.severity}] ${f.where}: ${f.msg}\n`);
  process.stdout.write('\nFix what is true. Never invent a number to clear a [metric] flag.\n');
  process.exit(0);
}

// Lint one candidate evidence bullet before it's folded into resume.yaml — the
// deterministic half of /fh two-month-test. Reuses the exact checks lintResume
// applies to in-resume bullets, so a draft that passes here passes there too.
// Reads the draft by file (keeps a pasted PR/ticket blurb out of the shell —
// core/RULES.md §9) or inline --text. Informs, never gates, never writes.
function cmdBullet(args) {
  let text;
  if (args.flags.file) {
    const path = resolve(args.flags.file);
    if (!existsSync(path)) die(3, `Missing file: ${path}`);
    try { text = readFileSync(path, 'utf8'); }
    catch (e) { die(3, `Could not read ${path}: ${e.message}`); }
  } else if (typeof args.flags.text === 'string') {
    text = args.flags.text;
  } else {
    die(2, 'bullet needs --file <path> or --text "your drafted bullet".');
  }
  text = text.trim().replace(/\s+/g, ' ');
  if (!text) die(2, 'bullet is empty; draft the evidence bullet first (outcome + number + method).');

  const flags = [];
  const add = (severity, msg) => flags.push({ severity, where: 'bullet', msg });
  const first = text.split(/\s+/)[0]?.toLowerCase().replace(/[^a-z]/g, '') || '';
  if (DUTY_OPENERS.has(first)) add('duty', `opens with "${first}", duty phrasing, not evidence. Lead with the outcome.`);
  if (!hasDigit(text)) add('metric', 'no number; run the metric excavation, a real number was probably there.');
  if (wordCount(text) > 32) add('length', `${wordCount(text)} words; tighten to one measurable claim.`);
  if (DASH_RE.test(text)) add('style', 'contains an em/en dash; use a comma, colon, or hyphen.');
  if (PRONOUN_RE.test(text)) add('pronoun', 'contains a first-person pronoun (I/me/my/we/our); resumes are written in implied first person.');
  const bw = findBuzzword(text);
  if (bw) add('buzzword', `contains "${bw}"; show the trait through an achievement instead of claiming it.`);

  const evidenceShaped = !flags.some((f) => f.severity === 'metric' || f.severity === 'duty');
  const report = { text, word_count: wordCount(text), flags, evidence_shaped: evidenceShaped };

  if (args.flags.json) { process.stdout.write(JSON.stringify(report, null, 2) + '\n'); process.exit(0); }

  process.stdout.write(`Bullet check — ${flags.length} flag(s), ${evidenceShaped ? 'evidence-shaped' : 'not yet evidence-shaped'}. This INFORMS; nothing is written until you confirm and log the bullet into config/resume.yaml.\n\n  "${text}"\n\n`);
  if (!flags.length) process.stdout.write('  Clean: a number is present and it leads with the outcome. The human read still matters (is the method named, is it true?).\n');
  else for (const f of flags) process.stdout.write(`  [${f.severity}] ${f.msg}\n`);
  process.stdout.write('\nA [metric] flag means keep excavating for the real number, never invent one. If none survives, one true sentence is the bullet.\n');
  process.exit(0);
}

function cmdCoverage(args) {
  const file = resumePath(args);
  const doc = loadYaml(file, { missingCode: 3 });
  const errors = validateResume(doc);
  if (errors.length) {
    process.stderr.write('Refusing to run coverage: resume.yaml is malformed. Run `resume.mjs validate` first.\n');
    errors.forEach((e) => process.stderr.write(`ERROR ${e}\n`));
    process.exit(1);
  }
  const keywords = collectKeywords(args);
  const { overlay } = resolveOverlay(args, doc);
  const { segSet, segLabel, headline } = resolveFraming(args, overlay, doc);
  const selected = selectForSegment(doc, segSet, overlay);
  selected.headline = headline;
  const { present, missing: notInFraming } = keywordCoverage(extractResumeText(selected), keywords);

  // A term missing from this framing may still be earned — somewhere in the master
  // career record. Split it out so "you lack X" becomes "you have X, resurface it".
  const in_master = [], missing = [];
  for (const kw of notInFraming) {
    const found_in = findKeywordInMaster(doc, kw);
    if (found_in.length) in_master.push({ keyword: kw, found_in });
    else missing.push(kw);
  }

  if (args.flags.json) {
    process.stdout.write(JSON.stringify({ segment: segLabel, present, missing, in_master, keyword_count: keywords.length }, null, 2) + '\n');
    process.exit(0);
  }
  process.stdout.write(`Keyword coverage for "${segLabel}" — ${present.length}/${keywords.length} present${in_master.length ? `, ${in_master.length} in the master but not this framing` : ''}. This INFORMS which resume to send and what to earn; it never blocks applying.\n\n`);
  process.stdout.write(present.length ? `  present: ${present.join(', ')}\n` : '  present: (none)\n');
  for (const m of in_master) process.stdout.write(`  in_master: ${m.keyword} — ${m.found_in.join('; ')}\n`);
  process.stdout.write(missing.length ? `  missing: ${missing.join(', ')}\n` : '  missing: (none)\n');
  if (in_master.length) process.stdout.write('\nin_master terms are already earned — resurface one via a wider --segment, another role preset, or an overlay pin:/include: of the listed id. No new writing needed.\n');
  if (missing.length) process.stdout.write('\nFor each missing term: add the exact word only if the work honestly supports it (never keyword-stuff); otherwise it is a proof-backlog gap to earn.\n');
  process.exit(0);
}

async function cmdBuild(args) {
  const file = resumePath(args);
  const doc = loadYaml(file, { missingCode: 3 });
  const errors = validateResume(doc);
  if (errors.length) {
    process.stderr.write('Refusing to build: resume.yaml is malformed. Run `resume.mjs validate` first.\n');
    errors.forEach((e) => process.stderr.write(`ERROR ${e}\n`));
    process.exit(1);
  }

  const { forId, overlay, note } = resolveOverlay(args, doc);
  const { segSet, segLabel, headline, role } = resolveFraming(args, overlay, doc);
  const pageKey = String(args.flags.page || 'letter').toLowerCase();
  if (!PAGE_FORMATS[pageKey]) die(2, `Unknown --page "${pageKey}" (allowed: letter | a4)`);

  const selected = selectForSegment(doc, segSet, overlay);
  selected.headline = headline;
  const html = renderHtml(selected, segLabel, pageKey);

  const outDir = args.flags.out ? resolve(args.flags.out) : join(ROOT, 'data/out');
  mkdirSync(outDir, { recursive: true });
  // Slug the filename component (forId is already slugged; role/segLabel are not).
  const base = `resume-${safeSlug(forId || role || segLabel) || 'resume'}`;
  const htmlPath = join(outDir, `${base}.html`);
  // Belt-and-suspenders: the render must land directly inside outDir, never above it.
  if (dirname(resolve(htmlPath)) !== resolve(outDir)) die(2, `Refusing to write outside the output directory: ${htmlPath}`);
  writeFileSync(htmlPath, html);

  const bulletsIncluded = selected.experience.reduce((n, e) => n + e.bullets.length, 0)
    + selected.projects.reduce((n, p) => n + p.bullets.length, 0);

  const trackerNote = forId && pipelineHasEntry(forId) === false
    ? `no pipeline entry "${forId}" — log this application with /fh so the funnel counts it.`
    : null;

  let pdf = null, pdfNote = null;
  if (args.flags.pdf) {
    const pdfPath = join(outDir, `${base}.pdf`);
    const res = await renderPdf(html, pdfPath, pageKey);
    if (res.ok) pdf = pdfPath;
    else pdfNote = res.reason;
  }

  if (args.flags.json) {
    process.stdout.write(JSON.stringify({ ok: true, for: forId, role, segment: segLabel, html: htmlPath, pdf, pdf_note: pdfNote, bullets_included: bulletsIncluded, overlay_note: note, tracker_note: trackerNote }, null, 2) + '\n');
    process.exit(0);
  }
  const framingLabel = role ? `role "${role}" (${segLabel})` : `segment "${segLabel}"`;
  const label = forId ? `application "${forId}" — ${framingLabel}` : framingLabel;
  process.stdout.write(`Built ${label}: ${bulletsIncluded} bullets.\n  HTML: ${htmlPath}\n`);
  if (pdf) process.stdout.write(`  PDF:  ${pdf}\n`);
  else if (args.flags.pdf) process.stdout.write(`  PDF:  skipped — ${pdfNote}\n        Open the HTML in a browser and Cmd/Ctrl+P → Save as PDF in the meantime.\n`);
  else process.stdout.write(`  (open the HTML and Cmd/Ctrl+P → Save as PDF, or re-run with --pdf)\n`);
  if (note) process.stdout.write(`  note: ${note}\n`);
  if (trackerNote) process.stdout.write(`  note: ${trackerNote}\n`);
  process.exit(0);
}

// ---------- entry ----------

const args = parseArgs(process.argv.slice(2));
const cmd = args._[0];
if (cmd === 'validate') cmdValidate(args);
else if (cmd === 'lint') cmdLint(args);
else if (cmd === 'bullet') cmdBullet(args);
else if (cmd === 'coverage') cmdCoverage(args);
else if (cmd === 'build') await cmdBuild(args);
else die(2, `Usage: resume.mjs <validate|lint|bullet|coverage|build> [--file <path>] [--json]
  validate                                          check config/resume.yaml is well-formed
  lint     [--segment a,b | --role <name>] [--for <id>]   deterministic proof flags (informs, never gates)
  bullet   (--file <draft.txt> | --text "…")             lint one candidate evidence bullet before you log it
                      (metric/duty/length/style/pronoun/buzzword flags + evidence_shaped; informs, never gates or writes)
  coverage --keywords "a,b,…" [--keywords-file <path>] [--segment a,b | --role <name> | --for <id>]
                      which JD keywords appear in the resume you'd send (present), live elsewhere
                      in the master record (in_master, with bullet ids), or are absent (missing)
  build    [--segment a,b | --role <name>] [--for <id>] [--pdf]   render a resume
           [--page letter|a4] [--out <dir>]
    --segment a,b     union of segments to include (e.g. product,backend)
    --role <name>     a framing preset from roles: in config/resume.yaml (headline + segments)
    --for <entry-id>  tailor for one application via config/tailor/<entry-id>.yaml
                      (overlay selects/pins/drops master bullets — never invents)`);
