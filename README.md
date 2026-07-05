# find-me-a-job

[![tests](https://github.com/yaralahruthik/find-me-a-job/actions/workflows/test.yml/badge.svg)](https://github.com/yaralahruthik/find-me-a-job/actions/workflows/test.yml)

Run your job search by talking to your AI CLI: Claude Code, Codex, Gemini CLI, Cursor, or any agent that reads `AGENTS.md`. You say what happened ("applied to Acme yesterday", "Swiggy rejected me"); it keeps a strict tracker, computes your weekly numbers, tailors your resume honestly, and runs a review ritual with you. **The philosophy is law**: the tool never lets dishonest data in, never grades you on outcomes you can't control, and never blocks you from applying.

> The whole thing in one sentence: **you cannot control offers, so run everything you can control as a system and let the numbers do the judging.**

The discipline this tool enforces is taught in FrontendHire's **[Finding Work](https://frontendhire.com/learn/finding-work)** course. This repo is that philosophy compressed into a tool; the course is the full *why*, and the best place to start if you want the thinking behind every rule here.

## What using it looks like

You talk in plain language; the agent enforces the discipline:

```
you>  /fh log applied to Razorpay SDE-1 via referral from Karthik
it>   Shows you the exact tracker diff (new row: razorpay-sde1, channel: referral,
      stage: applied), asks you to confirm, writes it, and validates the file.

you>  /fh status
it>   Runs the metrics script and reads you this week's five numbers. It never
      does the arithmetic itself.

you>  they said "we'd love to have you"!
it>   Congratulates you, logs it as a note, and kindly explains that only a
      written offer moves the stage.
```

Every write goes through the same ritual: show the diff, confirm, validate. Bad data physically can't produce numbers; metrics refuse to run until the tracker is clean.

## Get started

Requires Node ≥ 18. Two commands:

```bash
git clone https://github.com/yaralahruthik/find-me-a-job.git
cd find-me-a-job
```

Then open the folder in your agent and say `/fh init`. It checks your environment, installs anything missing (with your consent), and walks you through the 20-30 minute onboarding: profile, resume intake, tracker with your real recent history, and your first week's numbers.

Prefer the terminal? `npm run setup` does the environment part in one command (add `-- --pdf` for one-command PDF resumes; skipping it is fine, the HTML resume prints to PDF with Cmd/Ctrl+P). Setup also wires a pre-commit guard that refuses to commit your personal files.

Pick your agent:

| Agent | Entry point | How to invoke |
| --- | --- | --- |
| Claude Code | `.claude/skills/fh/SKILL.md` | `/fh status`, `/fh log …` |
| Codex CLI | `AGENTS.md` (native) + `.agents/skills/fh/SKILL.md` | `$fh`, or just type "fh status" |
| Gemini CLI | `GEMINI.md` + `.gemini/commands/fh.toml` | `/fh status`, `/fh log …` |
| Cursor | `AGENTS.md` (native) + `.cursor/skills/fh/SKILL.md` | `/fh` skill, or just type "fh status" |

Any other agent starts at [`AGENTS.md`](AGENTS.md); it carries the same instructions, and every example in this README works as plain text (`fh status` instead of `/fh status`).

## Day to day

```
/fh log applied to Razorpay SDE-1 via referral from Karthik
/fh status                 # this week's five numbers
/fh review                 # the weekly ritual (on your review day)
/fh wins cleared my first OA
/fh validate               # check the tracker is clean
/fh proof                  # re-audit resume & projects
/fh resume                 # render a tailored resume for a target segment
/fh evaluate               # paste a JD → which resume to send + proof gaps (alias: jd)
/fh source                 # fill leads, draft a referral/outreach ask, log it (alias: outreach)
/fh leads                  # paste found job URLs → confirmed lead rows (alias: ingest)
/fh two-month-test         # just shipped? capture the numbers now → resume bullet (aliases: capture, get-me-numbers)
/fh loop                   # prep your interviews, debrief each round while fresh (aliases: interview, prep, debrief)
```

Freeform text works too: `/fh it looks like Swiggy rejected me` routes to logging and applies the honesty rules.

## The tracker and the five numbers

One file, one row per application. Stages (`lead → applied → response → screen → loop → offer`) and channels (`cold-portal | referral | outreach | drive`) are defined precisely and enforced, so your numbers mean something. Every week, from your tracker:

1. Applications sent this week, by channel (vs your target)
2. Referral asks and outreach messages made (vs targets)
3. Response rate by channel, cumulative, with baselines and sample-size guards
4. Your **bottleneck arrow**: the first funnel step that's below baseline with a real sample
5. Leads remaining

The agent reads these numbers from a deterministic script; it never does the arithmetic itself. Silence is the default, not a verdict: at a ~3% cold response rate, thirty applications producing one response *is the system working normally*. The numbers turn most of the search's despair into arithmetic.

## The weekly review

Once a week, on your review day, `/fh review` runs the ritual: sweep the tracker for anything that moved, read the five numbers, grade the week **on inputs** (the applications and asks you controlled, never the responses you didn't), and pick **exactly one** change for next week. The review also reads your funnel's week-over-week movement, how long applications sit at each stage, and which open rows have stalled, so follow-ups pick themselves.

`/fh wins` keeps the wins log: the rebuttal file for the week-six slump. Log every win the day it happens; read it back the week nothing moves.

## The honesty rules

The agent enforces these kindly, but it won't budge:

- An autoreceipt ("we received your application") is **not** a response.
- A rejection **closes** the row and leaves the stage where it reached; rows are never deleted or moved backward.
- A **verbal** "we'd love to have you" is a note, not an offer. Only a written offer is an offer.
- A bookmark is a **lead**, not an application. A referral **ask** is an input, never an application.
- Easy Apply blasts get counted, but tagged honestly as `cold-portal`, because their low response rate is exactly the data you need.
- Weeks are graded on **inputs**, never outcomes. One change per week.

Full text in [`core/RULES.md`](core/RULES.md).

## Your resume: one master, many honest tailorings

Your resume lives as structured data, the **master career record**: everything you've ever done, unbounded by page size, so the system always has your full history as context. Every rendered resume is a *selection* from it, built into a classic-serif, ATS-safe one-pager (HTML, and PDF if you installed the browser):

- **Segments.** Tag each bullet with the segments it fits (`product`, `backend`, …) and `/fh resume` renders the selection for a target. Tag a bullet `archive` to keep it in the record without shipping it; "cutting for space" means re-tagging, never deleting.
- **Role framings.** The same person is often a "Product Engineer" for one JD and a "Full-Stack Engineer" for another. Name each framing once (a headline + segment set) and render it by name, with no duplicated resume to maintain.
- **Per-application tailoring, honestly.** Instead of forking your resume into a dozen drifting copies, keep one master and add a thin overlay per job, keyed to the application's row in your tracker. An overlay can pin, drop, reorder, and re-headline; it **cannot add a bullet**. Every claim still lives in one audited place, so per-JD tailoring can never quietly become per-JD fabrication. Tailoring reorders and hides *your own true bullets*: it never fabricates a skill, number, or keyword. Lies surface at the screen.

`/fh proof` audits the record against the proof-of-work standard: a deterministic lint flags duty-verb openers, number-less bullets, over-one-page length, first-person pronouns, buzzword fluff, broken reverse-chronology, unexplained gaps, and contact-block problems, and the agent rewrites weak bullets with honest metric excavation. It **informs**; it never blocks a build, and it never invents a metric. The written standard behind it is [`core/RESUME-RULES.md`](core/RESUME-RULES.md), distilled from Canada Job Bank, Harvard career services, Coursera, and a 1000-resume reviewer's field notes.

## Reading a job description

Paste a JD into `/fh evaluate` (alias: `jd`) and the tool tells you **which resume to send** and **what proof the JD wants that you can't yet show**, without ever telling you not to apply.

It classifies the role, picks the tightest framing to render, and runs a deterministic keyword check: which JD terms **literally appear** in the resume you'd send, which live **in your master** but not this framing (the fix is a pin, not new writing), and which are **missing** everywhere. Reproducible facts, never a "match %". A truly missing term is either a word to add honestly (if the work supports it) or a gap to *earn*, which lands in your proof backlog. Fit informs the framing and the backlog; it never gates whether you apply. Volume stays sacred.

## Referrals and outreach

Referrals are the highest-converting channel in the market and the one early-career searchers most underuse. `/fh source` (alias: `outreach`) works that channel honestly: it reads your weekly channel budget from the numbers, helps you pick who to ask, and drafts a **specific, finished** ask with the exact role + link, one true proof line, your resume attached, and an explicit out.

The draft gets a deterministic quality check that flags the ways an ask gets ignored: a template placeholder, no personal name, no role link, no proof line, no out, too long. It **never blocks sending**, and it never writes a word for you: personalization must be true (never a fabricated mutual, shared college, or proof point). A sent ask is logged as an **input**, never counted as an application until you actually submit. Most stranger-asks go unanswered. That's the channel working normally, which is exactly why asks are a weekly target, not a one-time embarrassment.

## Filling your lead list

A pipeline starves without leads. `/fh leads` (alias: `ingest`) takes a batch of job URLs you found and turns them into deduped, id-assigned candidate rows you confirm and log, so filling the list to twenty stops being twenty rounds of copy-paste.

Paste each link (ideally with the company + role copied from the posting): the tool assigns a unique id, defaults the channel from the host (aggregators → `cold-portal`), flags anything it had to **guess** so you confirm it, and sets aside URLs already in your tracker, because a lead is never counted twice. It **never decides which jobs deserve an application**; that's your positioning statement's job. And it never fabricates a company, role, or channel: confirmed rows go in through the same diff-and-validate ritual as everything else. A pasted bookmark is a **lead, not an application**.

## Interview loops

Reaching the interviews is the highest-leverage late-funnel work, and the one place the tracker can't help you. `/fh loop` (aliases: `interview`, `prep`, `debrief`) runs the prep-and-debrief discipline: it lists your live interviews stalest-first, preps the **actual rounds this company runs** (machine coding, UI, system design, fundamentals, HM), lines up the true proof to have ready, runs a **seniority-fit check**, and captures each round's post-mortem *while it's fresh* into a per-loop craft file.

A loop stays **one stage; each round is a dated event**: no per-round conversion math, by design. The tracker keeps the funnel truth; the debrief file holds what a script can't (what was asked, where it wobbled, what to prep next). Write the post-mortem, then close the file: the note is for the next round's prep, not a 1 a.m. replay. A **verbal** "we'd love to have you" is never an offer; only a written one moves the stage.

## Capture your numbers the day you ship

The best time to get the numbers off a feature you built is the day it ships, while the dashboard still shows them, you still have access, and the memory is sharp. Two months later the metric that was always there is gone. `/fh two-month-test` (aliases: `capture`, `get-me-numbers`) runs that capture: it excavates the real number (how many used it, what the manual version took, what it scored before and after), drafts an *outcome + number + method* bullet, and folds it into your master record so your resume gets one bullet truer while you can still defend every word.

The drafted bullet gets the same deterministic check that judges every bullet already in your resume. A metric flag means keep digging for the real number: **never invent one**. If nothing honest survives the questioning, one true sentence is the bullet; a numberless truth beats a percentage you can't back up.

## Under the hood

The product is markdown plus small deterministic scripts. `core/` holds the playbooks the agent follows: [`RULES.md`](core/RULES.md) (the binding law), [`SCHEMA.md`](core/SCHEMA.md) (the data contract), and [`ROUTER.md`](core/ROUTER.md) (the command table, plus the full script reference). `scripts/` holds the Node engines that compute every number, so the agent never does arithmetic. Your entire funnel is one YAML file (`data/pipeline.yaml`); all personal data is gitignored, with committed `.example` files showing the shape. `npm test` covers the scripts.

## Security & privacy

This is a local-first tool that holds your real resume and job search, driven by an agent that reads untrusted text (job descriptions, postings, messages). The safeguards:

- **Your data stays local.** The scripts make no network calls; the only external process is a local headless browser that renders your resume PDF, with JavaScript disabled and network blocked.
- **Personal data is never committed.** `.gitignore` covers everything personal by pattern, and an opt-in pre-commit guard (`git config core.hooksPath .githooks`, or `npm run guard`) refuses to commit a `config/*.yaml`, `config/tailor/`, `config/assets/`, or `data/*` file.
- **Ingested content is data, not instructions.** The agent treats a JD, page, or message as data to analyse: it never obeys directives hidden inside one, constrains web fetching to the exact URL you paste, and passes untrusted text to scripts by file, never inline on a command line (`core/RULES.md` §9).

Full threat model and how to report a vulnerability: [`SECURITY.md`](SECURITY.md).

## Inspiration

- Initial inspiration from **[santifer/career-ops](https://github.com/santifer/career-ops)**: where career-ops automates *applying*, this automates *running the search as a measured system*.

## License / spirit

[MIT](LICENSE), free on purpose. If it helps you land something, hand it to someone else who is searching.
