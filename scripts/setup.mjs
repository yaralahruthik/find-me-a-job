#!/usr/bin/env node
// setup.mjs — one-command environment bootstrap, so getting started is
// clone → open your agent → /fh init. Dependency-free on purpose (node builtins
// only): it has to run before `npm ci` has ever happened.
//
// Modes:
//   (default)        act: npm ci if deps are missing, wire the pre-commit guard,
//                    report PDF status, point at /fh init. Explicit invocation
//                    only — never a lifecycle hook (see SECURITY.md).
//   --pdf            also install the Playwright chromium used for PDF resumes.
//   --check [--json] report-only doctor; exit 0 ready, 1 not. Touches nothing.
//
// Like guard.mjs, every spawn uses fixed args and no shell; nothing here reads
// or writes a personal file.

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

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

// ---------- probes (read-only) ----------

const NODE_MAJOR_MIN = 18;

function probeNode() {
  const major = Number(process.versions.node.split('.')[0]);
  return { ok: major >= NODE_MAJOR_MIN, version: process.versions.node };
}

function probeDeps() {
  return existsSync(join(ROOT, 'node_modules', 'yaml', 'package.json'));
}

function probeHooks() {
  try {
    const out = execFileSync('git', ['config', 'core.hooksPath'], { cwd: ROOT, encoding: 'utf8' }).trim();
    return out === '.githooks';
  } catch { return false; }  // unset, or not a git repo
}

// Only meaningful once deps exist; report 'unknown' cheaply otherwise. The
// tracker and metrics never need this — it powers `resume build --pdf` alone.
async function probeChromium(depsInstalled) {
  if (!depsInstalled) return 'unknown';
  try {
    const { chromium } = await import('playwright');
    return existsSync(chromium.executablePath());
  } catch { return 'unknown'; }
}

function probeConfig() {
  return {
    profile: existsSync(join(ROOT, 'config', 'profile.yaml')),
    pipeline: existsSync(join(ROOT, 'data', 'pipeline.yaml')),
  };
}

async function status() {
  const node = probeNode();
  const deps = probeDeps();
  const config = probeConfig();
  return {
    node,
    deps,
    hooks: probeHooks(),
    chromium: await probeChromium(deps),
    config,
    // Ready to talk to the agent: tooling in place. The interview (config) is
    // /fh init's job, not a readiness gate here — but we surface it.
    ready: node.ok && deps,
  };
}

// ---------- commands ----------

async function cmdCheck(args) {
  const s = await status();
  if (args.flags.json) { process.stdout.write(JSON.stringify(s, null, 2) + '\n'); process.exit(s.ready ? 0 : 1); }
  process.stdout.write(`setup check:\n`);
  process.stdout.write(`  node      ${s.node.ok ? 'ok' : 'TOO OLD'} (${s.node.version}, need >= ${NODE_MAJOR_MIN})\n`);
  process.stdout.write(`  deps      ${s.deps ? 'installed' : 'missing (run: npm run setup)'}\n`);
  process.stdout.write(`  guard     ${s.hooks ? 'wired (pre-commit personal-data guard)' : 'not wired (npm run setup wires it)'}\n`);
  process.stdout.write(`  pdf       ${s.chromium === true ? 'ready' : s.chromium === false ? 'browser not installed (npm run setup -- --pdf); HTML + Cmd/Ctrl+P works meanwhile' : 'unknown until deps install'}\n`);
  process.stdout.write(`  config    ${s.config.profile && s.config.pipeline ? 'set up' : 'not yet — run /fh init in your AI CLI'}\n`);
  process.exit(s.ready ? 0 : 1);
}

function run(cmd, cmdArgs, label) {
  process.stdout.write(`setup: ${label}\n  $ ${cmd} ${cmdArgs.join(' ')}\n`);
  execFileSync(cmd, cmdArgs, { cwd: ROOT, stdio: 'inherit' });
}

async function cmdSetup(args) {
  const node = probeNode();
  if (!node.ok) die(1, `setup: Node ${node.version} is too old — this needs Node >= ${NODE_MAJOR_MIN}. Install a current LTS (https://nodejs.org) and re-run.`);

  if (!probeDeps()) {
    try { run('npm', ['ci'], 'installing dependencies (yaml, playwright — lockfile-pinned)'); }
    catch (e) { die(1, `setup: npm ci failed: ${e.message}`); }
  } else {
    process.stdout.write('setup: dependencies already installed.\n');
  }

  try { run('git', ['config', 'core.hooksPath', '.githooks'], 'wiring the pre-commit personal-data guard'); }
  catch { process.stdout.write('setup: could not set core.hooksPath (not a git repo?) — skipping the guard hook.\n'); }

  if (args.flags.pdf) {
    try { run('npx', ['playwright', 'install', 'chromium'], 'installing the browser used to render resume PDFs'); }
    catch (e) { die(1, `setup: browser install failed: ${e.message}`); }
  } else if ((await probeChromium(true)) !== true) {
    process.stdout.write('setup: PDF browser not installed (optional). `resume build` still writes HTML you can print to PDF; run `npm run setup -- --pdf` for one-command PDFs.\n');
  }

  process.stdout.write('\nsetup: done. Next step: open this folder in your AI CLI and run `/fh init` (about 20-30 minutes, it builds your profile, tracker, and first numbers).\n');
  process.exit(0);
}

// ---------- entry ----------

const args = parseArgs(process.argv.slice(2));
if (args.flags.check) await cmdCheck(args);
else if (args._.length === 0) await cmdSetup(args);
else die(2, `Usage: setup.mjs [--pdf] | --check [--json]
  (default)  install deps if missing, wire the commit guard, report PDF status.
  --pdf      also install the Playwright chromium for one-command PDF resumes.
  --check    report-only readiness doctor (exit 0 ready, 1 not); writes nothing.`);
