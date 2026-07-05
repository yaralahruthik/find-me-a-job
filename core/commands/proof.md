# /fh proof — audit resume & projects against the standard

Grade the user's proof of work and improve it *now*. Callable standalone or invoked by `/fh init` step 3. **This informs; it never gatekeeps** — nothing here blocks logging applications or seeing metrics. Thin proof is a finding in `data/proof-backlog.md`, not a wall.

Read `config/profile.yaml` (`proof_points`, `target_segment`) and, if present, the originals in `config/assets/`. If no resume has been ingested, ask for it first (or work from what the user tells you).

**Source of truth:** the resume's structured content lives in `config/resume.yaml` — the **master career record**, unbounded by page size; every rendered resume is a selection from it (see `core/SCHEMA.md`). Capture everything true here; the renderer decides what ships per framing. If it doesn't exist yet, this audit is where you build it — copy `config/resume.example.yaml` → `config/resume.yaml` and fill it from the user's real evidence (start from `proof_points`). Populate the header from the contact/links gathered at intake — **email, location, GitHub, personal site** — and if any are missing, nudge for them now rather than shipping a resume without them. Rewrites accepted below are folded back into `config/resume.yaml`, and `/fh resume` renders it into a tailored artifact.

## 1. Grade the resume

Run the mechanical pass first if `config/resume.yaml` exists: `node scripts/resume.mjs lint --segment <target> --json`. It flags duty-verb openers, bullets with no number, likely-over-one-page length, and the `core/RESUME-RULES.md` checks (pronouns, buzzwords, a references line, broken reverse-chronology, 6-month-plus gaps, over-7-bullet roles, contact hygiene). Treat every flag as a prompt for the human judgement below — the script finds the candidates; you do the honest grading and rewriting.

Against the standard (**`core/RESUME-RULES.md`** is the written version, with sources):
- **One page** at 0–3 years — for the **built artifact per framing**, never the master. An over-length master is healthy (it's the full record); an over-length concrete framing means re-tagging the weakest bullets (`archive`, or a narrower segment), never deleting a true one. (`lint --segment all` reflects this: the master view reports an `info`, not a `[length]` flag.)
- **Evidence bullets, not duty bullets.** "Built the reports page" (attendance) vs "Cut reports load 6s→1.8s, measured with Lighthouse, by moving filtering server-side" (ownership). Mark every weak/duty bullet.
- **Headline = positioning statement**, not a 2012 "objective" paragraph.
- **Honest keyword alignment** with the target segment's typical JD (say Next.js if the project uses Next.js). Alignment, never invention — lies surface at the screen.

## 2. Rewrite weak bullets — the metric excavation, run now

For each weak bullet, interrogate the user to find the metric that was always there but nobody tracked:
- "How many people used the thing?" · "What did the manual version take?" · "How often did the bug fire?" · "What did the page score before and after?"
- If a number **survives** the questioning, it was real and defensible — rewrite the bullet as *outcome + number + method* (the "Accomplished X, as measured by Y, by doing Z" formula, `core/RESUME-RULES.md` §1).
- If **nothing** honest surfaces, do **not** invent a percentage (it reads as fake and interviews find it). Write one true sentence about what changed and for whom. That is the bullet.

Show each rewrite; let the user accept or reject it. Fold accepted rewrites into `config/resume.yaml` (the master record) and keep the highlight set in `config/profile.yaml` `proof_points` in sync. When a rewrite supersedes an old bullet, tag the old one `segments: [archive]` rather than deleting it — the record keeps the history. Tag each bullet's `segments` so `/fh resume` can tailor — but a bullet true for every target keeps `segments: []` (always shown). Write with plain punctuation — **no em dashes** (commas, colons, hyphens); `lint` flags them and the renderer normalizes them.

This is the periodic full-resume audit. Its live, single-feature counterpart is `/fh two-month-test` (`core/commands/two-month-test.md`): the same excavation run *the day you ship*, while the numbers are still on a dashboard you can reach, folding one fresh bullet into `config/resume.yaml`. Point the user there when they mention shipping something new.

## 3. Projects — decide if they belong, then grade

First decide whether a Projects section should exist at all. Projects are the main event **for candidates with little or no work history**; for someone whose professional experience already carries the proof, a Projects section usually just costs one-page space. Be agnostic: include projects only if experience is thin/absent, or a project is genuinely extraordinary. If you keep them, grade against the four deep-marks below; if not, fold any standout into Experience or `interview_assets` — or keep it in the master tagged `archive`, where coverage can still find it and an overlay can resurrect it for the one JD that wants it — and skip this grading.

One or two deep projects beat ten tutorials. Deep means:
- **Deployed and usable at a real URL** (not a localhost screenshot).
- **Real users**, even a handful — someone who isn't the user gave feedback.
- **Decisions written down** — who it's for, what they chose *not* to build, one thing users taught them, one knowing tradeoff.
- **AI leverage on display** — which tools, how they reviewed the output, what they rejected. In 2026 "built with heavy AI assistance, here's my workflow and judgment" beats pretending every character was typed.

A tutorial clone proves diligence, not judgment; the screen finds nothing to ask about. If nothing is close to deep, the highest-leverage move is the **one-screen artifact**: pick a product the target company ships, find a real friction point, and write it up (screen → what I observed → hypothesis + smallest fix → how I'd check). One real artifact this week beats a rushed repo next month.

## 4. Write the backlog

Write `data/proof-backlog.md`: the graded findings, the bullets rewritten vs still-weak, each project's deep-marks scorecard, and a short ordered list of the highest-leverage gaps to close. Mark status per item (done / in progress / open). This is a working document the user burns down over weeks.

**Burn-down loop.** On a later `/fh proof`, read the existing backlog first and re-grade the open items instead of starting fresh: which gaps closed, which are still open, what's newly the top lever. Update statuses in place; don't lose the history. If `config/resume.yaml` changed, re-run `lint` and reconcile.

`/fh evaluate` (`core/commands/evaluate.md`) feeds this same backlog: when a specific JD wants proof your resume can't yet show, that gap lands here as a line to earn — never a bullet to fabricate.

## 5. Build the artifact

If the user has `config/resume.yaml` and wants the updated resume out, hand off to `core/commands/resume.md`: `node scripts/resume.mjs build --segment <target>` (add `--pdf` for a PDF). The audit changes the *content*; `/fh resume` renders the *artifact*. Don't block on this — it's optional and repeatable.

## Close

Give the honest headline: is the proof of work at bar for the target segment, or is it the real bottleneck? If it's thin, say so directly and kindly — the best-run funnel converts nothing on thin proof, and the honest response is sometimes a season spent building. But never let that stop them logging and measuring in the meantime.
