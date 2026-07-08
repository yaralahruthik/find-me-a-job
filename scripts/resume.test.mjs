import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, 'resume.mjs');
const FIX = join(HERE, 'fixtures');
const VALID = join(FIX, 'resume-valid.yaml');

function run(argv) {
  try {
    const stdout = execFileSync('node', [SCRIPT, ...argv], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { code: 0, stdout, stderr: '' };
  } catch (e) {
    return { code: e.status ?? 1, stdout: e.stdout?.toString() ?? '', stderr: e.stderr?.toString() ?? '' };
  }
}

const freshOut = () => mkdtempSync(join(tmpdir(), 'resume-out-'));

test('validate: well-formed fixture passes (exit 0)', () => {
  const r = run(['validate', '--file', VALID]);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /well-formed/);
});

test('validate: malformed fixture fails (exit 1) naming the missing field', () => {
  const r = run(['validate', '--file', join(FIX, 'resume-bad.yaml')]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /missing required field "name"/);
  assert.match(r.stderr, /missing "role"|missing "text"/);
});

test('validate: missing file exits 3', () => {
  const r = run(['validate', '--file', join(FIX, 'nope.yaml')]);
  assert.equal(r.code, 3);
  assert.match(r.stderr, /Missing file/);
});

test('no subcommand exits 2 (usage)', () => {
  const r = run([]);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /Usage:/);
});

test('build: segment selection hides off-segment bullets, writes self-contained HTML', () => {
  const out = freshOut();
  const r = run(['build', '--file', VALID, '--segment', 'product', '--out', out, '--json']);
  assert.equal(r.code, 0, r.stderr);
  const res = JSON.parse(r.stdout);
  assert.equal(res.ok, true);
  assert.equal(res.segment, 'product');
  // "billing product" (untagged) + "A-0" project bullet (untagged) included;
  // the [design]-only design-system bullet is excluded for segment product.
  assert.equal(res.bullets_included, 2);

  const html = readFileSync(res.html, 'utf8');
  assert.match(html, /Shipped the billing product/);
  assert.doesNotMatch(html, /design system/);
  assert.match(html, /Grace Hopper/);
  // Self-contained: no external stylesheet/script/font references.
  assert.doesNotMatch(html, /<link[^>]+href|<script|https?:\/\/[^"']*\.(css|js|woff)/);
});

test('build: --segment all includes every bullet', () => {
  const out = freshOut();
  const r = run(['build', '--file', VALID, '--segment', 'all', '--out', out, '--json']);
  const res = JSON.parse(r.stdout);
  assert.equal(res.bullets_included, 3);
});

test('build: refuses on malformed resume (exit 1)', () => {
  const out = freshOut();
  const r = run(['build', '--file', join(FIX, 'resume-bad.yaml'), '--out', out]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /Refusing to build/);
});

test('build: --pdf always writes HTML and exits 0, even without a browser', () => {
  const out = freshOut();
  const r = run(['build', '--file', VALID, '--segment', 'product', '--out', out, '--pdf', '--json']);
  assert.equal(r.code, 0, r.stderr);
  const res = JSON.parse(r.stdout);
  assert.equal(res.ok, true);
  // HTML is the guaranteed artifact; pdf may be null if playwright/browser is absent.
  const html = readFileSync(res.html, 'utf8');
  assert.match(html, /Grace Hopper/);
  if (res.pdf === null) assert.ok(res.pdf_note, 'a skipped PDF should explain why');
});

test('lint: flags duty phrasing and bulletless-metric, but never fails the build', () => {
  const r = run(['lint', '--file', join(FIX, 'resume-lint.yaml'), '--segment', 'all', '--json']);
  assert.equal(r.code, 0, r.stderr);
  const report = JSON.parse(r.stdout);
  const severities = report.flags.map((f) => f.severity);
  assert.ok(severities.includes('duty'), 'should flag the "Responsible for" opener');
  assert.ok(severities.includes('metric'), 'should flag bullets with no number');
});

test('lint: a clean resume reports no proof flags', () => {
  const r = run(['lint', '--file', VALID, '--segment', 'product', '--json']);
  assert.equal(r.code, 0, r.stderr);
  const report = JSON.parse(r.stdout);
  const flagged = report.flags.filter((f) => f.severity === 'duty' || f.severity === 'metric');
  assert.equal(flagged.length, 0, JSON.stringify(report.flags));
});

// ---------- per-application overlays (Phase 2.1) ----------

test('validate: duplicate bullet ids in the master are rejected', () => {
  const r = run(['validate', '--file', join(FIX, 'resume-dup-id.yaml')]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /duplicate bullet id "shared"/);
});

test('build --for: overlay drops, force-includes, and re-headlines from the master', () => {
  const out = freshOut();
  const r = run(['build', '--file', VALID, '--for', 'stripe-swe', '--layout', 'flat',
    '--tailor-file', join(FIX, 'tailor-valid.yaml'), '--out', out, '--json']);
  assert.equal(r.code, 0, r.stderr);
  const res = JSON.parse(r.stdout);
  assert.equal(res.for, 'stripe-swe');
  assert.equal(res.segment, 'product', 'overlay segment should win over the profile default');
  assert.match(res.html, /resume-stripe-swe\.html$/);

  const html = readFileSync(res.html, 'utf8');
  assert.match(html, /Frontend-leaning Product Engineer/);     // headline override applied
  assert.doesNotMatch(html, /billing product/);                // dropped bullet gone
  assert.match(html, /design system/);                         // [design] bullet force-included at segment=product
});

test('build --for: pin floats a bullet to the top of its section', () => {
  const out = freshOut();
  const r = run(['build', '--file', VALID, '--for', 'x', '--tailor-file', join(FIX, 'tailor-pin.yaml'), '--out', out, '--json']);
  const res = JSON.parse(r.stdout);
  const html = readFileSync(res.html, 'utf8');
  assert.ok(html.indexOf('design system') < html.indexOf('billing product'), 'pinned bullet should render before the earlier-authored one');
});

test('build --for: a content-bearing or dangling-reference overlay is refused (exit 1)', () => {
  const out = freshOut();
  const r = run(['build', '--file', VALID, '--for', 'x', '--tailor-file', join(FIX, 'tailor-bad.yaml'), '--out', out]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /unknown bullet id "does-not-exist"/);
  assert.match(r.stderr, /"bullets" is not allowed|only select from the master/);
});

test('build --for: missing overlay is a soft note, not a failure', () => {
  const out = freshOut();
  const r = run(['build', '--file', VALID, '--for', 'never-tailored', '--segment', 'product', '--layout', 'flat', '--out', out, '--json']);
  assert.equal(r.code, 0, r.stderr);
  const res = JSON.parse(r.stdout);
  assert.match(res.overlay_note, /no overlay at/);
  assert.match(res.html, /resume-never-tailored\.html$/);
});

// ---------- per-lead output folders (Phase 9) ----------

test('build --for: default layout writes data/out/<id>/<name>.{html} named after the user', () => {
  const out = freshOut();
  const r = run(['build', '--file', VALID, '--for', 'stripe-swe', '--layout', 'per-lead-folder',
    '--tailor-file', join(FIX, 'tailor-output.yaml'), '--out', out, '--json']);
  assert.equal(r.code, 0, r.stderr);
  const res = JSON.parse(r.stdout);
  assert.equal(res.layout, 'per-lead-folder');
  assert.equal(res.dir, join(out, 'stripe-swe'), 'the lead gets its own folder named by the entry id');
  assert.match(res.html, /stripe-swe\/GraceHopper\.html$/, 'the resume is named after the user (PascalCase, no spaces)');
  const html = readFileSync(res.html, 'utf8');
  assert.doesNotMatch(html, /billing product/, 'the overlay still drops bullets in the new layout');
});

test('build --for: overlay resume_filename template beats the profile default (A/B)', () => {
  const out = freshOut();
  const r = run(['build', '--file', VALID, '--for', 'stripe-swe', '--segment', 'product', '--layout', 'per-lead-folder',
    '--tailor-file', join(FIX, 'tailor-output-role.yaml'), '--out', out, '--json']);
  assert.equal(r.code, 0, r.stderr);
  const res = JSON.parse(r.stdout);
  assert.match(res.html, /stripe-swe\/GraceHopper-product\.html$/, '{name}-{role} expands to PascalCase name + sanitized role');
});

test('build --for: overlay resolves from the lead folder first (new location wins)', () => {
  const out = freshOut();
  mkdirSync(join(out, 'stripe-swe'), { recursive: true });
  writeFileSync(join(out, 'stripe-swe', 'tailor.yaml'),
    'version: 1\nsegment: product\ndrop: [billing]\noutput:\n  resume_filename: "{name}"\n');
  const r = run(['build', '--file', VALID, '--for', 'stripe-swe', '--layout', 'per-lead-folder', '--out', out, '--json']);
  assert.equal(r.code, 0, r.stderr);
  const res = JSON.parse(r.stdout);
  assert.equal(res.overlay_note, null, 'the folder overlay was found, no soft note');
  assert.match(res.html, /stripe-swe\/GraceHopper\.html$/);
  assert.doesNotMatch(readFileSync(res.html, 'utf8'), /billing product/, 'the folder tailor.yaml was applied');
});

test('build --for: a missing overlay names the lead-folder path first', () => {
  const out = freshOut();
  const r = run(['build', '--file', VALID, '--for', 'never-tailored', '--segment', 'product', '--layout', 'per-lead-folder', '--out', out, '--json']);
  assert.equal(r.code, 0, r.stderr);
  const res = JSON.parse(r.stdout);
  assert.match(res.overlay_note, /never-tailored\/tailor\.yaml/, 'the new folder location is checked first');
});

test('build --for: an overlay setting output.layout is refused (exit 1)', () => {
  const out = freshOut();
  const r = run(['build', '--file', VALID, '--for', 'x', '--tailor-file', join(FIX, 'tailor-output-bad.yaml'), '--out', out]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /output\.layout" is not allowed|profile-level choice/);
});

test('build --for: an overlay whose output is not a mapping is refused (exit 1)', () => {
  const out = freshOut();
  const r = run(['build', '--file', VALID, '--for', 'x', '--tailor-file', join(FIX, 'tailor-output-badmap.yaml'), '--out', out]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /"output" must be a mapping/);
});

test('build: an unknown --layout is rejected (exit 2)', () => {
  const out = freshOut();
  const r = run(['build', '--file', VALID, '--segment', 'product', '--layout', 'sideways', '--out', out]);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /Unknown output layout/);
});

// ---------- role framing + multi-segment (Phase 2.2) ----------

const ROLES = join(FIX, 'resume-roles.yaml');

test('build --role: preset sets the headline and its segment set', () => {
  const out = freshOut();
  const r = run(['build', '--file', ROLES, '--role', 'product', '--out', out, '--json']);
  assert.equal(r.code, 0, r.stderr);
  const res = JSON.parse(r.stdout);
  assert.equal(res.role, 'product');
  assert.equal(res.segment, 'product');
  assert.equal(res.bullets_included, 2, 'product + always-on, backend excluded');
  assert.match(res.html, /resume-product\.html$/);
  const html = readFileSync(res.html, 'utf8');
  assert.match(html, /Senior Product Engineer/);
  assert.doesNotMatch(html, /payments API/);
});

test('build --role fullstack: unions product + backend and retitles', () => {
  const out = freshOut();
  const r = run(['build', '--file', ROLES, '--role', 'fullstack', '--out', out, '--json']);
  const res = JSON.parse(r.stdout);
  assert.equal(res.segment, 'product+backend');
  assert.equal(res.bullets_included, 3);
  const html = readFileSync(res.html, 'utf8');
  assert.match(html, /Full-Stack Engineer/);
  assert.match(html, /checkout flow/);
  assert.match(html, /payments API/);
});

test('build --segment a,b: multi-segment union without a preset', () => {
  const out = freshOut();
  const r = run(['build', '--file', ROLES, '--segment', 'product,backend', '--out', out, '--json']);
  const res = JSON.parse(r.stdout);
  assert.equal(res.segment, 'product+backend');
  assert.equal(res.bullets_included, 3);
});

test('build --role: an unknown role name is a usage error (exit 2)', () => {
  const out = freshOut();
  const r = run(['build', '--file', ROLES, '--role', 'nope', '--out', out]);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /Unknown role "nope"/);
});

test('overlay role: an application can pick a framing; overlay headline still wins', () => {
  const out = freshOut();
  const r = run(['build', '--file', ROLES, '--for', 'acme', '--tailor-file', join(FIX, 'tailor-role.yaml'), '--out', out, '--json']);
  const res = JSON.parse(r.stdout);
  assert.equal(res.segment, 'product', 'role product => product segment');
  assert.equal(res.bullets_included, 2);
  const html = readFileSync(res.html, 'utf8');
  assert.match(html, /Custom Per-JD Title/);        // overlay headline beats the role preset headline
  assert.doesNotMatch(html, /Senior Product Engineer/);
});

test('validate: a malformed role preset is rejected', () => {
  const r = run(['validate', '--file', join(FIX, 'resume-bad-roles.yaml')]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /role "broken": "segments" must be a non-empty list/);
});

// ---------- presentation: serif template + dash normalization (Phase 2.3) ----------

const DASH = join(FIX, 'resume-dash.yaml');

test('render: uses the classic serif template stack', () => {
  const out = freshOut();
  const r = run(['build', '--file', VALID, '--segment', 'product', '--out', out, '--json']);
  const html = readFileSync(JSON.parse(r.stdout).html, 'utf8');
  assert.match(html, /font-family:\s*Charter, 'Bitstream Charter', 'Times New Roman', serif/);
  assert.doesNotMatch(html, /Helvetica/);
});

test('render: jakegut layout — small-caps, pipe-separated contacts, two-row experience heading', () => {
  const out = freshOut();
  const r = run(['build', '--file', VALID, '--segment', 'product', '--out', out, '--json']);
  const html = readFileSync(JSON.parse(r.stdout).html, 'utf8');
  assert.match(html, /font-variant:\s*small-caps/);
  assert.match(html, /<div class="contact-row"><span class="ci">grace@example\.com<\/span> \| <span class="ci">Remote<\/span><\/div>/, 'contact details (email, location) grouped on their own row');
  assert.match(html, /<div class="contact-row"><span class="ci"><a [^>]*>github\.com\/grace<\/a><\/span><\/div>/, 'links on a separate row');
  assert.match(html, /<span class="item-title">Founding Engineer<\/span>/, 'bold role on its own row');
  assert.doesNotMatch(html, /Founding Engineer, Compiler Co\./, 'role and company no longer merge on one line');
  assert.match(html, /<div class="item-row item-sub"><span>Compiler Co\.<\/span>/, 'italic company row below');
});

test('render: contact is two grouped rows (details | links), no dangling separator, multi-word value intact', () => {
  const out = freshOut();
  const r = run(['build', '--file', join(FIX, 'resume-contact.yaml'), '--segment', 'all', '--out', out, '--json']);
  assert.equal(r.code, 0, r.stderr);
  const html = readFileSync(JSON.parse(r.stdout).html, 'utf8');
  // Row 1: email | phone | location, with the multi-word location in ONE atomic span and no trailing pipe.
  assert.match(html, /<div class="contact-row"><span class="ci">grace@example\.com<\/span> \| <span class="ci">\+91 90000 00000<\/span> \| <span class="ci">Hyderabad, India<\/span><\/div>/, 'details row pipe-joined, location atomic, no trailing pipe');
  // Row 2: the links, on their own row — details and links are not intermixed.
  assert.match(html, /<div class="contact-row"><span class="ci"><a [^>]*>github\.com\/grace<\/a><\/span> \| <span class="ci"><a [^>]*>grace\.dev<\/a><\/span> \| <span class="ci"><a [^>]*>LinkedIn<\/a><\/span><\/div>/, 'links on a separate row');
  assert.doesNotMatch(html, / \|<\/div>/, 'no separator ever sits at a row edge');
});

test('render: no Summary section when the master has none', () => {
  const out = freshOut();
  const r = run(['build', '--file', VALID, '--segment', 'product', '--out', out, '--json']);
  const html = readFileSync(JSON.parse(r.stdout).html, 'utf8');
  assert.doesNotMatch(html, /<h2>Summary<\/h2>/);
});

test('render: section_order puts education first for a fresh grad', () => {
  const out = freshOut();
  const r = run(['build', '--file', join(FIX, 'resume-order.yaml'), '--segment', 'all', '--out', out, '--json']);
  assert.equal(r.code, 0, r.stderr);
  const html = readFileSync(JSON.parse(r.stdout).html, 'utf8');
  assert.ok(html.indexOf('<h2>Education</h2>') < html.indexOf('<h2>Experience</h2>'), 'education renders before experience');
  assert.ok(html.indexOf('<h2>Experience</h2>') < html.indexOf('<h2>Skills</h2>'), 'unlisted sections keep default order after the listed ones');
});

test('validate: section_order rejects unknown and duplicate sections', () => {
  const r = run(['validate', '--file', join(FIX, 'resume-bad-order.yaml')]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /unknown section "nope"/);
  assert.match(r.stderr, /duplicate section "experience"/);
});

// ---------- date granularity (config field + overlay override) ----------

test('render: default date granularity is month ("Jun 2025 - Present" style)', () => {
  const out = freshOut();
  const r = run(['build', '--file', VALID, '--segment', 'all', '--out', out, '--json']);
  assert.equal(r.code, 0, r.stderr);
  const html = readFileSync(JSON.parse(r.stdout).html, 'utf8');
  assert.match(html, /<span class="item-date">Jan 2024 - Present<\/span>/, 'month is the default');
});

test('render: date_granularity: year renders years only and collapses a same-year range', () => {
  const out = freshOut();
  const r = run(['build', '--file', join(FIX, 'resume-year.yaml'), '--segment', 'all', '--out', out, '--json']);
  assert.equal(r.code, 0, r.stderr);
  const html = readFileSync(JSON.parse(r.stdout).html, 'utf8');
  assert.doesNotMatch(html, /[A-Z][a-z]{2} \d{4}/, 'no month-name date should survive in year mode');
  assert.match(html, /<span class="item-date">2024 - Present<\/span>/, 'open range shows years');
  assert.match(html, /<span class="item-date">2021<\/span>/, 'a same-year role collapses to one year');
});

test('validate: date_granularity rejects an unknown value (exit 1)', () => {
  const r = run(['validate', '--file', join(FIX, 'resume-bad-granularity.yaml')]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /date_granularity/);
});

test('build --for: an overlay date_granularity overrides the master default (A/B)', () => {
  const out = freshOut();
  // VALID has no date_granularity (defaults to month); the overlay forces year.
  const r = run(['build', '--file', VALID, '--for', 'x', '--tailor-file', join(FIX, 'tailor-year.yaml'), '--out', out, '--json']);
  assert.equal(r.code, 0, r.stderr);
  const html = readFileSync(JSON.parse(r.stdout).html, 'utf8');
  assert.match(html, /<span class="item-date">2024 - Present<\/span>/, 'overlay year beats the month default');
  assert.doesNotMatch(html, /Jan 2024/, 'the master default month should not leak through');
});

test('build --for: an overlay with a bad date_granularity is refused (exit 1)', () => {
  const out = freshOut();
  const r = run(['build', '--file', VALID, '--for', 'x', '--tailor-file', join(FIX, 'tailor-bad-granularity.yaml'), '--out', out]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /date_granularity/);
});

test('render: em dashes become commas and en-dash ranges become hyphens; none ship', () => {
  const out = freshOut();
  const r = run(['build', '--file', DASH, '--segment', 'all', '--out', out, '--json']);
  const html = readFileSync(JSON.parse(r.stdout).html, 'utf8');
  assert.doesNotMatch(html, /[—–]/, 'no em/en dash should survive to the output');
  assert.match(html, /core product, dashboards, alerts, forecasting, used by 40 teams/);
  assert.match(html, /3-4s/);
});

test('lint: flags em/en dashes as [style], and never gates', () => {
  const r = run(['lint', '--file', DASH, '--segment', 'all', '--json']);
  assert.equal(r.code, 0, r.stderr);
  const report = JSON.parse(r.stdout);
  assert.ok(report.flags.some((f) => f.severity === 'style'), 'should flag the dashes');
});

test('lint: [info] nudge when both experience and projects are present', () => {
  const r = run(['lint', '--file', DASH, '--segment', 'all', '--json']);
  const report = JSON.parse(r.stdout);
  const info = report.flags.find((f) => f.severity === 'info');
  assert.ok(info, 'should nudge about the projects section');
  assert.match(info.msg, /early-career or extraordinary/);
});

// ---------- keyword coverage (Phase 3: JD evaluation) ----------

const COV = join(FIX, 'resume-coverage.yaml');

test('coverage: splits present vs missing and never gates (exit 0)', () => {
  const r = run(['coverage', '--file', COV, '--segment', 'all', '--keywords', 'graphql,kubernetes,rust', '--json']);
  assert.equal(r.code, 0, r.stderr);
  const res = JSON.parse(r.stdout);
  assert.deepEqual(res.present.sort(), ['graphql', 'kubernetes']);
  assert.deepEqual(res.missing, ['rust']);
  assert.deepEqual(res.in_master, [], 'a keyword nowhere in the master stays missing');
  assert.equal(res.keyword_count, 3);
});

test('coverage: matching is case-insensitive', () => {
  const r = run(['coverage', '--file', COV, '--segment', 'all', '--keywords', 'GRAPHQL', '--json']);
  assert.deepEqual(JSON.parse(r.stdout).present, ['GRAPHQL']);
});

test('coverage: whole-token match — "react" does not match "reaction"/"Reactor"', () => {
  const r = run(['coverage', '--file', COV, '--segment', 'all', '--keywords', 'react,reaction', '--json']);
  const res = JSON.parse(r.stdout);
  assert.deepEqual(res.missing, ['react'], 'react must not match reaction or Reactor');
  assert.deepEqual(res.present, ['reaction']);
});

test('coverage: multi-word phrases and punctuated terms match', () => {
  const r = run(['coverage', '--file', COV, '--segment', 'all', '--keywords', 'system design,node.js,ci/cd', '--json']);
  const res = JSON.parse(r.stdout);
  assert.deepEqual(res.missing, [], JSON.stringify(res));
  assert.equal(res.present.length, 3);
});

test('coverage: is framing-aware — an off-framing keyword reads as in_master, not missing', () => {
  const product = JSON.parse(run(['coverage', '--file', ROLES, '--role', 'product', '--keywords', 'checkout,payments', '--json']).stdout);
  assert.deepEqual(product.present, ['checkout']);
  assert.deepEqual(product.missing, [], 'payments is in the master, so it is not a true gap');
  assert.equal(product.in_master.length, 1);
  assert.equal(product.in_master[0].keyword, 'payments');
  assert.match(product.in_master[0].found_in[0], /^experience "Stack Co\." bullet #\d+ \(id: /, 'attribution names the master bullet');
  const fullstack = JSON.parse(run(['coverage', '--file', ROLES, '--role', 'fullstack', '--keywords', 'checkout,payments', '--json']).stdout);
  assert.deepEqual(fullstack.present.sort(), ['checkout', 'payments'], 'union surfaces the backend bullet');
});

test('coverage: requires keywords (exit 2)', () => {
  const r = run(['coverage', '--file', COV, '--segment', 'all']);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /--keywords/);
});

test('coverage: refuses on a malformed resume (exit 1)', () => {
  const r = run(['coverage', '--file', join(FIX, 'resume-bad.yaml'), '--keywords', 'react']);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /Refusing to run coverage/);
});

// ---------- master career record: the archive tag ----------

const ARCHIVE = join(FIX, 'resume-archive.yaml');
const LONG = join(FIX, 'resume-long.yaml');

test('validate: an archive-tagged bullet with other segment tags is rejected', () => {
  const r = run(['validate', '--file', join(FIX, 'resume-archive-bad.yaml')]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /"archive" is exclusive/);
});

test('build: archive bullets are hidden from every concrete segment', () => {
  const out = freshOut();
  const r = run(['build', '--file', ARCHIVE, '--segment', 'product', '--out', out, '--json']);
  assert.equal(r.code, 0, r.stderr);
  const res = JSON.parse(r.stdout);
  assert.equal(res.bullets_included, 2, 'always-on + product; archived excluded');
  assert.doesNotMatch(readFileSync(res.html, 'utf8'), /mainframe/);
});

test('build: --segment all is the master view and includes archived bullets', () => {
  const out = freshOut();
  const res = JSON.parse(run(['build', '--file', ARCHIVE, '--segment', 'all', '--out', out, '--json']).stdout);
  assert.equal(res.bullets_included, 3);
  assert.match(readFileSync(res.html, 'utf8'), /mainframe/);
});

test('build --for: an overlay include resurrects an archived bullet', () => {
  const out = freshOut();
  const r = run(['build', '--file', ARCHIVE, '--for', 'legacy-shop', '--tailor-file', join(FIX, 'tailor-archive.yaml'), '--out', out, '--json']);
  assert.equal(r.code, 0, r.stderr);
  const res = JSON.parse(r.stdout);
  assert.equal(res.bullets_included, 3, 'product framing + the resurrected archive bullet');
  assert.match(readFileSync(res.html, 'utf8'), /mainframe/);
});

test('build: --segment archive renders always-on + archived bullets only', () => {
  const out = freshOut();
  const res = JSON.parse(run(['build', '--file', ARCHIVE, '--segment', 'archive', '--out', out, '--json']).stdout);
  assert.equal(res.bullets_included, 2);
  const html = readFileSync(res.html, 'utf8');
  assert.match(html, /mainframe/);
  assert.doesNotMatch(html, /usage dashboard/);
});

test('coverage: a keyword carried only by an archived bullet reports in_master with attribution', () => {
  const r = run(['coverage', '--file', ARCHIVE, '--segment', 'product', '--keywords', 'mainframe,rust', '--json']);
  assert.equal(r.code, 0, r.stderr);
  const res = JSON.parse(r.stdout);
  assert.deepEqual(res.missing, ['rust']);
  assert.equal(res.in_master.length, 1);
  assert.equal(res.in_master[0].keyword, 'mainframe');
  assert.deepEqual(res.in_master[0].found_in, ['experience "Old Systems Inc." bullet #2 (id: legacy-cobol)']);
});

test('lint: --segment all never flags document [length]; the master may run long', () => {
  const r = run(['lint', '--file', LONG, '--segment', 'all', '--json']);
  assert.equal(r.code, 0, r.stderr);
  const report = JSON.parse(r.stdout);
  assert.ok(report.line_estimate > 52, 'fixture must actually be over a page');
  assert.ok(!report.flags.some((f) => f.severity === 'length' && f.where === 'document'), JSON.stringify(report.flags));
  const info = report.flags.find((f) => f.severity === 'info' && f.where === 'document');
  assert.ok(info && /master/.test(info.msg), 'an info explains the master view is allowed to run long');
});

test('lint: a concrete framing still flags over-one-page', () => {
  const r = run(['lint', '--file', LONG, '--segment', 'product', '--json']);
  const report = JSON.parse(r.stdout);
  assert.ok(report.flags.some((f) => f.severity === 'length' && f.where === 'document'), JSON.stringify(report.flags));
});

test('lint: an id-less archived bullet gets a warn under the master view', () => {
  const r = run(['lint', '--file', join(FIX, 'resume-archive-noid.yaml'), '--segment', 'all', '--json']);
  assert.equal(r.code, 0, r.stderr);
  const report = JSON.parse(r.stdout);
  assert.ok(report.flags.some((f) => f.severity === 'warn' && /archived but has no id/.test(f.msg)), JSON.stringify(report.flags));
});

// ---------- security hardening ----------

test('build: a traversal --for is slugged and stays inside the output dir', () => {
  const out = freshOut();
  const r = run(['build', '--file', VALID, '--for', '../../pwn', '--segment', 'product', '--layout', 'flat', '--out', out, '--json']);
  assert.equal(r.code, 0, r.stderr);
  const html = JSON.parse(r.stdout).html;
  assert.equal(dirname(html), out, 'render must land directly inside --out, never above it');
  assert.match(html, /resume-pwn\.html$/, 'the ../.. is stripped to a safe slug');
});

test('build: a traversal --for stays inside the lead folder under per-lead-folder layout', () => {
  const out = freshOut();
  const r = run(['build', '--file', VALID, '--for', '../../pwn', '--segment', 'product', '--layout', 'per-lead-folder', '--out', out, '--json']);
  assert.equal(r.code, 0, r.stderr);
  const html = JSON.parse(r.stdout).html;
  assert.equal(dirname(html), join(out, 'pwn'), 'the ../.. is stripped to a safe folder inside --out');
  assert.ok(html.startsWith(out + '/'), 'the render must never escape --out');
});

test('build: a traversal --segment cannot escape the output dir', () => {
  const out = freshOut();
  const r = run(['build', '--file', VALID, '--segment', '../../etc/product', '--out', out, '--json']);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(dirname(JSON.parse(r.stdout).html), out);
});

test('build: a javascript: link renders as href="#", a normal link is unchanged', () => {
  const out = freshOut();
  const r = run(['build', '--file', join(FIX, 'resume-xss.yaml'), '--segment', 'all', '--out', out, '--json']);
  assert.equal(r.code, 0, r.stderr);
  const html = readFileSync(JSON.parse(r.stdout).html, 'utf8');
  assert.doesNotMatch(html, /href="javascript:/i, 'javascript: scheme must not survive into an href');
  assert.match(html, /href="#"/, 'the unsafe link is neutralized to #');
  assert.match(html, /href="https:\/\/github\.com\/ok"/, 'a normal https link is untouched');
});

// ---------- bullet: capture a shipped feature's number (/fh two-month-test) ----------

const BULLET_EVIDENCE = join(FIX, 'bullet-evidence.txt');
const BULLET_WEAK = join(FIX, 'bullet-weak.txt');

test('bullet: an evidence draft (number + method) is evidence-shaped with no metric/duty flag', () => {
  const r = run(['bullet', '--file', BULLET_EVIDENCE, '--json']);
  assert.equal(r.code, 0, r.stderr);
  const rep = JSON.parse(r.stdout);
  assert.equal(rep.evidence_shaped, true);
  assert.equal(typeof rep.word_count, 'number');
  assert.ok(Array.isArray(rep.flags));
  assert.ok(!rep.flags.some((f) => f.severity === 'metric' || f.severity === 'duty'), JSON.stringify(rep.flags));
});

test('bullet: a weak draft flags both duty and metric, and is not evidence-shaped', () => {
  const r = run(['bullet', '--file', BULLET_WEAK, '--json']);
  assert.equal(r.code, 0, r.stderr);
  const rep = JSON.parse(r.stdout);
  assert.equal(rep.evidence_shaped, false);
  assert.ok(rep.flags.some((f) => f.severity === 'duty'), 'opens with "Responsible"');
  assert.ok(rep.flags.some((f) => f.severity === 'metric'), 'has no number');
  assert.equal(rep.flags[0].where, 'bullet');
});

test('bullet: --text is linted inline and reuses the same checks', () => {
  const r = run(['bullet', '--text', 'Cut build time 4min to 40s by caching the dependency graph', '--json']);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).evidence_shaped, true);
});

test('bullet: neither --file nor --text is a usage error (exit 2)', () => {
  const r = run(['bullet']);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /--file|--text/);
});

test('bullet: a missing --file exits 3', () => {
  const r = run(['bullet', '--file', join(FIX, 'nope.txt'), '--json']);
  assert.equal(r.code, 3);
  assert.match(r.stderr, /Missing file/);
});

test('bullet: informs, never gates — a flagged draft still exits 0', () => {
  const r = run(['bullet', '--file', BULLET_WEAK]);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /never invent one/);
});

// ---------- RESUME-RULES lint checks (core/RESUME-RULES.md) ----------

const STYLE_RULES = join(FIX, 'resume-style-rules.yaml');
const STYLE_CLEAN = join(FIX, 'resume-style-clean.yaml');

test('lint: fires each RESUME-RULES flag once on the violating fixture, and never gates', () => {
  const r = run(['lint', '--file', STYLE_RULES, '--segment', 'product', '--json']);
  assert.equal(r.code, 0, r.stderr);
  const severities = JSON.parse(r.stdout).flags.map((f) => f.severity);
  for (const s of ['pronoun', 'buzzword', 'references', 'order', 'gap', 'bullets', 'contact'])
    assert.ok(severities.includes(s), `should flag [${s}]; got ${JSON.stringify(severities)}`);
});

test('lint: education out of order is caught independently of experience', () => {
  const r = run(['lint', '--file', STYLE_RULES, '--segment', 'product', '--json']);
  const orderFlags = JSON.parse(r.stdout).flags.filter((f) => f.severity === 'order');
  assert.equal(orderFlags.length, 2, JSON.stringify(orderFlags));
  assert.ok(orderFlags.some((f) => /education/.test(f.msg)));
});

test('lint: [bullets] count rides only in a concrete framing, not the master view', () => {
  const r = run(['lint', '--file', STYLE_RULES, '--segment', 'all', '--json']);
  const severities = JSON.parse(r.stdout).flags.map((f) => f.severity);
  assert.ok(!severities.includes('bullets'), 'master view must not flag bullet count');
});

test('lint: the clean control raises none of the RESUME-RULES flags', () => {
  const r = run(['lint', '--file', STYLE_CLEAN, '--segment', 'product', '--json']);
  assert.equal(r.code, 0, r.stderr);
  const severities = JSON.parse(r.stdout).flags.map((f) => f.severity);
  for (const s of ['pronoun', 'buzzword', 'references', 'order', 'gap', 'bullets', 'contact'])
    assert.ok(!severities.includes(s), `unexpected [${s}] on clean fixture: ${r.stdout}`);
});

test('bullet: flags pronouns and buzzwords in a draft, still exits 0', () => {
  const r = run(['bullet', '--text', 'I am a passionate team player', '--json']);
  assert.equal(r.code, 0, r.stderr);
  const report = JSON.parse(r.stdout);
  const severities = report.flags.map((f) => f.severity);
  assert.ok(severities.includes('pronoun'), r.stdout);
  assert.ok(severities.includes('buzzword'), r.stdout);
  assert.equal(report.evidence_shaped, false);
});

test('bullet: pronoun/buzzword checks do not touch a clean evidence bullet', () => {
  const r = run(['bullet', '--text', 'Cut p95 latency 800ms to 210ms by batching 4 queries', '--json']);
  const report = JSON.parse(r.stdout);
  assert.equal(report.flags.length, 0, r.stdout);
  assert.equal(report.evidence_shaped, true);
});
