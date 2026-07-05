# ROUTER — subcommand dispatch

This is the CLI-agnostic routing table for the `fh` system. A host wrapper (Claude Code's `SKILL.md`, or another CLI's `AGENTS.md`) points here after loading `core/RULES.md`. Route the user's argument to the playbook, read that playbook, and follow it.

## Routing table

| Argument | Playbook | One-line intent |
| --- | --- | --- |
| `init` | `core/commands/init.md` | First-run onboarding: intake → positioning → proof → tracker → leads → targets → cadence → wins |
| `log` *(or any freeform text)* | `core/commands/log.md` | Record a lead, application, stage change, referral ask, or note |
| `status` | `core/commands/status.md` | The five numbers for the current week, 30-second read |
| `review` | `core/commands/review.md` | The weekly review ritual |
| `wins` | `core/commands/wins.md` | Add a win, or read the wins log back |
| `proof` | `core/commands/proof.md` | Audit resume + projects against the proof-of-work standard |
| `resume` | `core/commands/resume.md` | Render a tailored, ATS-safe resume from `config/resume.yaml` |
| `evaluate` *(or `jd`)* | `core/commands/evaluate.md` | Read a pasted JD: pick the resume framing, coverage-check keywords, capture proof gaps |
| `source` *(or `outreach`)* | `core/commands/source.md` | Work the referral & outreach channels: fill leads, draft a specific ask, quality-check it, log it |
| `leads` *(or `ingest`)* | `core/commands/leads.md` | Turn found job URLs, or a named company's careers-page openings, into deduped, id-assigned candidate lead rows to confirm and log |
| `two-month-test` *(or `capture`, `get-me-numbers`)* | `core/commands/two-month-test.md` | Capture a just-shipped feature's numbers while they're fresh: excavate the metric, draft an evidence bullet, fold it into `config/resume.yaml` |
| `loop` *(or `interview`, `prep`, `debrief`)* | `core/commands/loop.md` | Prep the interview loop on its actual content, run the seniority-fit check, and debrief each round while it's fresh into `data/debriefs/<entry-id>.md` |
| `validate` | `core/commands/validate.md` | Check `data/pipeline.yaml` and fix any problems |

**Freeform default:** if the argument is not one of the keywords above, it is almost always a logging request. Route to `log`.

## No-argument menu

When invoked with no argument, print this and wait:

```
fh — run your search as a measured system.

  /fh init      set up your search (first time)
  /fh log ...   record an application, lead, referral ask, or update
  /fh status    this week's five numbers
  /fh review    the weekly review ritual
  /fh wins      add or read your wins log
  /fh proof     audit your resume & projects
  /fh resume    render a tailored resume (by segment)
  /fh evaluate  read a JD: which resume to send, what proof it wants (alias: jd)
  /fh source    fill leads, draft a referral/outreach ask, log it (alias: outreach)
  /fh leads     turn job URLs or a named company's openings into confirmed lead rows (alias: ingest)
  /fh two-month-test  just shipped? capture the numbers now, before they fade (aliases: capture, get-me-numbers)
  /fh loop      prep your interviews and debrief each round while fresh (aliases: interview, prep, debrief)
  /fh validate  check your tracker is clean

New here? Start with /fh init.
```

If `data/pipeline.yaml` does not exist yet, add one line: `It looks like you haven't set up yet — run /fh init.`

## Invariants every playbook obeys (from core/RULES.md)

- Numbers only from `scripts/pipeline.mjs`. Never do the arithmetic yourself.
- Never show metrics when `validate` fails — fix the data first.
- Show the YAML diff before writing `pipeline.yaml`; run `validate` after every write; never leave it invalid.
- Grade weeks on inputs, never outcomes. One change per week.
- Proof of work informs; it never gatekeeps logging or metrics.

## Running the script

From the repo root:

- `node scripts/pipeline.mjs validate` — gate the data (exit 0 clean, 1 problems, 3 missing file).
- `node scripts/pipeline.mjs validate --accept-corrections` — allow a deliberate backward-stage fix.
- `node scripts/pipeline.mjs metrics --json` — the five numbers as JSON; render them faithfully. Includes `leads_by_channel` (open leads grouped by channel) for sourcing coaching.
- `node scripts/pipeline.mjs metrics --week 2026-W27` — a specific ISO week (defaults to the current one).
- `node scripts/pipeline.mjs interviews [--json]` — the live interviews (open entries at `screen`/`loop`, stalest first, with `days_since` and a `rounds` count); the deterministic half of `/fh loop`. Reads only, refuses on invalid data (exit 1), never gates.
- `node scripts/pipeline.mjs trends [--json] [--max-weeks N]` — the four funnel arrows, cumulative as of each past week (informs `/fh review`'s week-6 persist-or-pivot). Reads only, never gates.
- `node scripts/pipeline.mjs velocity [--json]` — time-in-stage medians + stalled open rows (informs `/fh review`). Reads only, never gates.
- `node scripts/pipeline.mjs migrate [--write]` — one-time: convert a legacy `dates: {stage: date}` map into the `history: [{stage, date}]` event log (dry run without `--write`; backs up to `<file>.bak`). Idempotent.

For the resume tooling (`config/resume.yaml`, isolated from the tracker — never needed for numbers):

- `node scripts/resume.mjs validate` — check `config/resume.yaml` is well-formed (exit 0/1, 3 if missing).
- `node scripts/resume.mjs lint --segment product --json` — deterministic proof + writing-standard flags (`core/RESUME-RULES.md`); informs, never gates.
- `node scripts/resume.mjs bullet (--file <draft.txt> | --text "…") [--json]` — lint one candidate evidence bullet before you log it (metric/duty/length/style/pronoun/buzzword flags + `evidence_shaped`); the deterministic half of `/fh two-month-test`. Informs, never gates or writes.
- `node scripts/resume.mjs coverage --keywords "a,b,…" --role fullstack --json` — which JD keywords literally appear in the resume you'd send; informs, never gates.
- `node scripts/resume.mjs build --segment product[,backend] [--pdf] [--page a4]` — render a segment (or a union) into `data/out/`.
- `node scripts/resume.mjs build --role fullstack [--pdf]` — render a role framing (headline + segments) preset in `config/resume.yaml`.
- `node scripts/resume.mjs build --for <entry-id> [--pdf]` — render a per-application resume using `config/tailor/<entry-id>.yaml` (an overlay that selects from the master; never invents).

For sourcing (drafted messages only — no personal data, no tracker):

- `node scripts/source.mjs lint --message "…" [--type referral|outreach] [--json]` — quality flags for a drafted ask (personalization, role link, proof line, explicit out, length); informs, never gates.

For lead ingestion (reads the tracker only to dedup + avoid id collisions; never writes — `core/commands/log.md` does):

- `node scripts/leads.mjs ingest (--file <path> | --urls "u1,u2,…") [--pipeline <path>] [--json]` — turn pasted job URLs into deduped, id-assigned candidate lead rows; channel defaulted from host, company/role guesses flagged to confirm, duplicates and no-link lines set aside. Always exits 0; informs and prepares, never gates.

For repo safety (a public-repo guard against committing personal data — see `SECURITY.md`):

- `node scripts/guard.mjs staged` — refuse the commit if any personal-data file (`config/*.yaml`, `config/tailor/`, `config/assets/`, `data/*`, except `*.example.yaml`) is staged. Exit 1 if any are. Opt in as a hook once with `git config core.hooksPath .githooks`.

For environment bootstrap (`/fh init` step 0; touches tooling only, never personal data):

- `node scripts/setup.mjs --check [--json]` — read-only readiness doctor (node, deps, guard hook, PDF browser, config presence); exit 0 ready, 1 not.
- `node scripts/setup.mjs [--pdf]` — install deps if missing (`npm ci`), wire the guard hook, optionally install the PDF browser. Explicit invocation only — never an install lifecycle hook.
