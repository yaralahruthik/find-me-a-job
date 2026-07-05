#!/usr/bin/env node
// source.mjs — deterministic quality check for a drafted referral ask or outreach
// message. One subcommand: `lint`, which flags the ways an ask fails the
// "specific and finished" bar (see core/RULES.md / core/SCHEMA.md). Like resume
// lint, every flag INFORMS and nothing here gates: a drafted ask always sends.
//
// Pure text — no yaml, no browser. The agent writes the message (personalized,
// honest); this file does the mechanical, repeatable scan. See core/RULES.md and
// core/commands/source.md.

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

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

// ---------- helpers ----------

const wordCount = (s) => (s.trim() ? s.trim().split(/\s+/).length : 0);
const HAS_URL = /https?:\/\//i;
const HAS_DIGIT = /\d/;
// A concrete role pointer: a real link, or an explicit job id / requisition number.
const HAS_JOB_ID = /\bjob\s*id\b|\bjob\s*#?\s*\d|\breq(uisition)?\.?\s*#?\s*\d/i;
// Unfilled template tokens or a to-anyone salutation — the mass-blast tells.
const PLACEHOLDER = /\[[^\]\n]*\]|\{[^}\n]*\}|<[^>\n]+>|\bto whom it may concern\b|\bdear sir\b|\bdear madam\b/i;
// A low-pressure out that makes "yes" (and "no") easy.
const HAS_OUT = /\b(no worries|totally fine|completely fine|no pressure|no rush|if not|no problem|understand if|totally understand|either way|feel free|happy to)\b/i;

// Length ceilings: an ask that demands reading gets ignored. Outreach runs tighter.
const MAX_WORDS = { referral: 130, outreach: 90 };

function lintAsk(message, type) {
  const flags = [];
  const add = (severity, msg) => flags.push({ severity, msg });
  const msg = String(message);

  if (PLACEHOLDER.test(msg))
    add('placeholder', 'unfilled template token or a to-anyone salutation; personalize it. People screenshot pasted asks.');

  // Inspect only the addressee (greeting word .. first comma/stop), not the whole
  // line — otherwise words like "team's" later in the sentence read as generic.
  const firstLine = (msg.split('\n').find((l) => l.trim()) || '').trim();
  const greet = /^(hi|hello|hey|dear|greetings)\b[ \t]*([^,\n.!?]*)/i.exec(firstLine);
  const addressee = greet ? greet[2].trim() : '';
  const genericAddressee = /\b(there|team|hiring manager|recruiter|sir|madam|folks|all|everyone|to whom)\b/i.test(addressee);
  const salutationOk = !!addressee && /[A-Z][a-z]/.test(addressee) && !genericAddressee;
  if (!salutationOk)
    add('salutation', 'no personal name in the greeting; address one specific person, not "there"/"hiring manager".');

  if (!HAS_URL.test(msg) && !HAS_JOB_ID.test(msg))
    add('role-link', 'no role link or job id; name the exact role and paste the link/ID so they do zero research.');

  if (!HAS_DIGIT.test(msg) && !HAS_URL.test(msg))
    add('proof', 'no proof line; add one honest number or a deployed link they can vouch for.');

  if (!HAS_OUT.test(msg))
    add('out', 'no explicit out; a low-pressure "totally fine if not" makes saying yes easier.');

  const wc = wordCount(msg);
  const max = MAX_WORDS[type] ?? MAX_WORDS.referral;
  if (wc > max)
    add('length', `${wc} words; over ~${max} for a ${type} ask. Long asks get ignored, tighten to the essentials.`);

  return { type, word_count: wc, flags };
}

// ---------- command ----------

function cmdLint(args) {
  let message;
  if (typeof args.flags.message === 'string') {
    message = args.flags.message;
  } else if (args.flags.file) {
    const p = resolve(args.flags.file);
    if (!existsSync(p)) die(3, `Missing --file: ${p}`);
    message = readFileSync(p, 'utf8');
  } else {
    die(2, 'lint needs --message "…" or --file <path>.');
  }

  const type = String(args.flags.type || 'referral').toLowerCase();
  if (type !== 'referral' && type !== 'outreach') die(2, `Unknown --type "${type}" (allowed: referral | outreach)`);

  const report = lintAsk(message, type);
  if (args.flags.json) { process.stdout.write(JSON.stringify(report, null, 2) + '\n'); process.exit(0); }

  if (!report.flags.length) {
    process.stdout.write(`No mechanical flags for this ${type} ask (${report.word_count} words). It reads specific and finished — send it.\n`);
    process.exit(0);
  }
  process.stdout.write(`Draft check for a ${type} ask — ${report.flags.length} flag(s). These INFORM; nothing here blocks sending.\n\n`);
  for (const f of report.flags) process.stdout.write(`  [${f.severity}] ${f.msg}\n`);
  process.stdout.write('\nFix what is true. A specific, personal ask beats twenty pasted ones, in conversion and reputation.\n');
  process.exit(0);
}

// ---------- entry ----------

const args = parseArgs(process.argv.slice(2));
const cmd = args._[0];
if (cmd === 'lint') cmdLint(args);
else die(2, `Usage: source.mjs lint (--message "…" | --file <path>) [--type referral|outreach] [--json]
  lint   deterministic quality flags for a drafted referral ask / outreach message
         (informs, never gates — a drafted ask always sends)`);
