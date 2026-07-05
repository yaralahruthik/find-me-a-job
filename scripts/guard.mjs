#!/usr/bin/env node
// guard.mjs — a commit-time safety net for a public repo. `staged` refuses the
// commit if any personal-data file is about to be committed, so a stray `git add`
// can't leak the user's resume, profile, or tracker. The .gitignore is the first
// line of defence; this is the second. See SECURITY.md.
//
// Wire it up once: `git config core.hooksPath .githooks` (the committed
// .githooks/pre-commit calls this). Or run `npm run guard` by hand.

import { execFileSync } from 'node:child_process';

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

// ---------- classification ----------

// A path holds personal data unless it is one of the committed templates. Keep
// this in lock-step with .gitignore: config/*.yaml|pdf (except *.example.yaml),
// config/tailor/**, config/assets/**, and everything under data/ except the two
// placeholders.
function isPersonalPath(p) {
  const f = String(p).replace(/^\.\//, '').trim();
  if (!f) return false;
  if (f === 'data/.gitkeep' || f === 'data/pipeline.example.yaml') return false;
  if (/^config\/.*\.example\.yaml$/.test(f)) return false;
  if (f.startsWith('config/tailor/')) return true;
  if (f.startsWith('config/assets/')) return true;
  if (/^config\/[^/]+\.(ya?ml|pdf)$/.test(f)) return true;
  if (f.startsWith('data/')) return true;
  return false;
}

function stagedFiles() {
  // Fixed args, no shell — nothing here is interpolated from untrusted input.
  const out = execFileSync('git', ['diff', '--cached', '--name-only', '--diff-filter=ACM'], { encoding: 'utf8' });
  return out.split('\n').map((l) => l.trim()).filter(Boolean);
}

// ---------- command ----------

function cmdStaged(args) {
  let files;
  if (typeof args.flags.files === 'string') {
    files = args.flags.files.split(',').map((s) => s.trim()).filter(Boolean);
  } else {
    try { files = stagedFiles(); }
    catch (e) { die(2, `Could not read staged files (is this a git repo?): ${e.message}`); }
  }

  const offenders = files.filter(isPersonalPath);
  if (args.flags.json) { process.stdout.write(JSON.stringify({ offenders }, null, 2) + '\n'); process.exit(offenders.length ? 1 : 0); }

  if (!offenders.length) {
    process.stdout.write('guard: no personal-data files staged. Safe to commit.\n');
    process.exit(0);
  }
  process.stderr.write('guard: REFUSING — personal-data files are staged for commit:\n');
  for (const f of offenders) process.stderr.write(`  ${f}\n`);
  process.stderr.write('\nUnstage them (`git restore --staged <file>`). These belong only on your machine (see SECURITY.md).\n');
  process.exit(1);
}

// ---------- entry ----------

const args = parseArgs(process.argv.slice(2));
const cmd = args._[0];
if (cmd === 'staged') cmdStaged(args);
else die(2, `Usage: guard.mjs staged [--files a,b,c] [--json]
  staged   refuse the commit if any personal-data file (config/*.yaml, config/tailor/,
           config/assets/, data/*, except *.example.yaml) is staged. Exit 1 if any are.`);
