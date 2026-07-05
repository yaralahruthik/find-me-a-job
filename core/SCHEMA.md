# SCHEMA — data contract

This document describes the shape of every file the system reads and writes. It mirrors, in prose, exactly what `scripts/pipeline.mjs validate` enforces. If this file and the validator ever disagree, the validator is the source of truth and this file is the bug.

All dates are ISO `YYYY-MM-DD`. No future dates.

---

## `data/pipeline.yaml`

The pipeline. One file, the single source of truth for the funnel.

```yaml
version: 1

entries:
  - id: zeta-frontend          # required. unique kebab-case slug. convention: <company>-<role-ish>.
    company: Zeta              # required, string
    role: Frontend Engineer    # required, string
    link: https://…            # required, string. a lead IS a URL — no link, no lead.
    channel: referral          # required, enum: cold-portal | referral | outreach | drive
    stage: screen              # required, enum: lead | applied | response | screen | loop | offer
    closed: false              # required, boolean
    closed_date: 2026-07-05    # required IFF closed: true (else omit or null)
    history:                   # required ordered event log — the entry's stage timeline
      - { stage: lead,     date: 2026-06-20 }   # lead optional (backfilled apps may not know it)
      - { stage: applied,  date: 2026-06-22 }   # an "applied" event is required once stage >= applied
      - { stage: response, date: 2026-06-29 }
      - { stage: screen,   date: 2026-07-01 }
      # only `loop` may repeat — one dated event per round:
      #   - { stage: loop, date: 2026-07-08, round: machine-coding, note: "felt ok" }
    referrer: Ananya Rao       # required IFF channel: referral AND stage >= applied
    notes:                     # optional list of strings; convention: "YYYY-MM-DD: text"
      - "2026-06-29: recruiter Priya replied; OA link"

asks:                          # referral asks & outreach messages — INPUTS, never applications
  - date: 2026-06-28           # required
    type: referral             # required, enum: referral | outreach
    person: Rahul M            # required, string
    company: Groww             # optional
    lead_id: groww-sde-1       # optional; if present, must match an existing entry id
    outcome: warm reply        # optional, free text
```

### Stage order

```
lead < applied < response < screen < loop < offer
```

### Required-field matrix

| Field         | Required when                                        |
| ------------- | ---------------------------------------------------- |
| id, company, role, link, channel, stage, closed | always                        |
| closed_date   | `closed: true`                                       |
| history "applied" event | `stage` is applied, response, screen, loop, or offer |
| referrer      | `channel: referral` and `stage` >= applied           |

### Validation rules (each violation = one error line, exit 1)

1. **Enums**: `channel`, `stage`, and ask `type` must be in their allowed sets.
2. **Required fields** present per the matrix above.
3. **Stage/history consistency**: `stage` must equal the *highest-order* stage present in `history`. Catches "moved the stage but forgot the event" and vice-versa.
4. **history** is an ordered list of `{ stage, date, round?, note? }`. Each event's `stage` is `<= stage` in pipeline order; every **non-loop** stage appears **at most once**, while `loop` may repeat (one event per round). Events are **weakly non-decreasing** by both stage order and date in list order (an earlier stage cannot come after a later one; equal dates are fine — same-day skips). `round`/`note` are optional strings, meaningful for loop rounds.
5. **Unique ids** across all entries.
6. **ask.lead_id**, if present, must reference an existing entry `id`.
7. **Dates**: parseable `YYYY-MM-DD`, not in the future.
8. **closed_date** present iff `closed: true`.

### Stage-regression guard (cross-run)

On every successful `validate`, the script snapshots `{id: {stage, closed}}` to `data/.state/last-validated.json`. On the next run it compares:

- an entry whose `stage` moved **backward** → error
- an entry that **vanished** (was present, now gone) → error

Both are overridable with `--accept-corrections` (for honest typo fixes). Forward movement, new entries, and closing rows are always fine and never need the flag.

---

## `config/profile.yaml`

Personal, gitignored. Created by `/fh init`. Later commands read this instead of re-parsing resumes/PDFs.

```yaml
name: ""
positioning_statement: ""      # one sentence: "I'm a [identity] who [proof], looking for [role] at [segment]."
target_segment: product        # product | startup | service
secondary_segment: null        # optional, same enum
experience_years: 2            # total professional experience, confirmed at init; used to mark stretch roles, never to gate
search_mode: employed          # employed | full-time  (seeds default targets)
review_day: sunday             # coaching only; the script always uses ISO weeks (Mon–Sun)
targets:                       # weekly INPUT targets — the only grades that exist
  applications: 7
  referral_asks: 2
  outreach_messages: 2
  prep_hours: 3
assets:                        # what the user handed init; originals live in config/assets/
  - file: resume.pdf
    type: resume               # resume | linkedin
    ingested: 2026-07-04
proof_points:                  # evidence bullets/projects distilled from the resume at init
  - "Shipped expense tracker to 40 real users; React + Node."
interview_assets:              # optional: proof that didn't earn resume space but belongs in a loop
  - "Side project: expense tracker, live at a real URL, 40 real users; good system-design story."
```

Default targets: `full-time` → applications 15, referral_asks 3, outreach_messages 2, prep_hours 5. `employed` → 7 / 2 / 2 / 3.

## `config/baselines.yaml`

Copied from `baselines.example.yaml` at init; user-editable ("a compass, not a scoreboard").

```yaml
app_to_response:
  cold-portal: [0.01, 0.05]
  referral:    [0.15, 0.40]
  outreach:    [0.05, 0.15]
  drive:       [0.01, 0.05]    # not in the course table; seeded = cold. a guess — edit for your market.
response_to_screen: [0.30, 0.50]
screen_to_loop:     [0.40, 0.60]
loop_to_offer:      [0.10, 0.25]
min_sample: 20                 # don't call a bottleneck under ~20 results at a stage
cold_share_warning: 0.80       # warn if >80% of applications are cold-portal
velocity_min_sample: 3         # velocity: show a median time-in-stage once this many transitions exist
stall_days: 21                 # velocity: flag an open row idle this many days
```

## `config/resume.yaml`

Personal, gitignored. The **master career record**: everything the user has ever done, unbounded by page size. Every rendered resume — the standard one and every tailored variant — is a *selection* from it; nothing true is ever deleted for space (space is managed by tagging, see the `archive` tag below). `scripts/resume.mjs` validates it and renders tailored HTML/PDF into `data/out/`. Isolated from the tracker — `validate`/`metrics` never read it, and it is never needed to compute a number.

```yaml
version: 1
name: Ada Lovelace          # required, string
headline: Senior Product Engineer   # your positioning, one line (lint warns if absent)
location: Remote            # optional
email: ada@example.com      # optional but strongly advised (lint warns if absent)
phone: null                 # optional
links:                      # optional list; each needs a url (label optional)
  - { label: github.com/ada, url: https://github.com/ada }
summary: "…"                # optional; renders only if present — most resumes should omit it and spend the space on bullets
section_order: [experience, projects, skills, education]   # optional; e.g. a fresh grad puts education first. Omitted sections keep default order after the listed ones.
experience:                 # optional list
  - company: Analytical Engines Inc.   # required per item
    role: Founding Engineer            # required per item
    location: Remote                   # optional
    start: 2024-01                     # optional, YYYY-MM
    end: present                       # optional, YYYY-MM or "present"
    bullets:
      - id: mcp-server                       # optional; unique across the file; lets overlays target it
        text: "Shipped … to 6+ customers."   # required per bullet
        segments: [product, ai]              # optional; [] or absent = always shown. `archive` (exclusive) = kept in the record, shipped in no build
projects:                   # optional list
  - name: Difference Engine # required per item
    url: https://…          # optional
    role: Creator           # optional
    bullets: [ { text: "…", segments: [] } ]
skills:                     # optional list
  - group: Languages        # required per item
    items: [TypeScript, Python]   # required, non-empty list
education:                  # optional list; free-form { school, degree, year }
  - { school: …, degree: …, year: 2022 }
roles:                      # optional; named framings of the same person
  product:   { headline: "Senior Product Engineer", segments: [product] }
  fullstack: { headline: "Full-Stack Engineer", segments: [product, backend] }
```

### Segment tailoring & role framing

A build resolves to a **set** of segments. A bullet is included iff it has no `segments` (or an empty list) **or** any of its tags is in that set. `all` includes everything.

- `build --segment product` — one segment.
- `build --segment product,backend` — the **union** (a bullet tagged either shows).
- `build --role fullstack` — a preset from `roles:` supplies both a headline **and** a segment set. This models "the same person is a Product Engineer for one JD and a Full-Stack Engineer for another" without duplicating the resume.
- Omitting all of them falls back to `config/profile.yaml` `target_segment`.

Precedence (highest first): explicit `--segment`/`--role` → the overlay's `segment`/`role` → the profile default. An explicit segment overrides a role's segment set; an overlay `headline` overrides a role's headline. Tailoring only reorders and hides the user's own true bullets — it never invents.

**The `archive` tag** keeps a bullet in the master without shipping it: old jobs, superseded work, deep-cut detail. An archived bullet is excluded from every concrete framing by construction, appears under `--segment all` (the master/audit view — not a shippable resume), and a per-application overlay can resurrect it by id with `include:`. `archive` is exclusive — it cannot be combined with other tags (validation error). "Cutting for space" always means re-tagging to `archive` or a narrower segment, never deleting: the record is how the system knows everything you've done. (`--segment archive` renders always-on + archived bullets; harmless, mainly for auditing.)

**Rendering is opinionated:** a classic-serif, jakegut-style template (Charter/Times, ATS-safe) — small-caps centered name, small-caps section headings over a full-width rule, bold role with right-aligned dates and an italic company/location row, tight one-page spacing. Em/en dashes are normalized in all display text (em → comma, en → hyphen). `summary` renders only when present (omit it by default); the `projects` section renders only when present — include it only when experience is thin or a project is extraordinary. Default section order is experience → projects → skills → education; `section_order:` may reorder.

### Validation rules (each violation = one error line, exit 1)

1. Top level is a mapping with a non-empty `name`.
2. Each `experience` item has non-empty `company` and `role`; `start`/`end` (if present) are `YYYY-MM` (or `end: present`).
3. Each `project` item has a non-empty `name`.
4. Every bullet is a mapping with non-empty `text`; `segments` (if present) is a list of non-empty strings; `id` (if present) is a non-empty string and **unique across the whole file** (so overlays resolve unambiguously).
5. Each `skills` group has a non-empty `group` and a non-empty `items` list.
6. Each `link` has a `url`.
7. `roles` (if present) is a mapping of name → `{ headline?, segments }`; each preset's `segments` is a non-empty list of strings.
8. `section_order` (if present) is a list drawn from `summary, experience, projects, skills, education`, no duplicates.
9. A bullet tagged `archive` carries no other segment tags (the archive contract is "in no build" — mixed tags would silently resurface it).

`lint` is separate and **never fails a build**: it flags duty-verb openers, number-less bullets, over-long bullets, an over-one-page estimate, a missing headline/email, and the `core/RESUME-RULES.md` writing-standard checks — `pronoun` (first-person pronouns), `buzzword` (self-description fluff), `references` ("references on request"), `order` (reverse-chronology broken, exact via the structured dates), `gap` (over 6 months between roles, info-level), `bullets` (over 7 in one role, concrete framings only), and `contact` (missing phone, non-name-based email). These inform; they never gate. The over-one-page flag applies to **concrete framings** only — under `--segment all` (the master view) it becomes an `info`, because the master career record is allowed to run long; `all` also warns about archived bullets with no `id` (an overlay can't resurrect them).

`coverage` (`resume.mjs coverage --keywords "a,b,…" [--segment|--role|--for]`) is the deterministic half of `/fh evaluate`: given JD keywords, it reports three buckets — `present` in the resume text for this framing; `in_master` (`[{ keyword, found_in }]` — absent from this framing but carried by a master bullet, with the exact locations/ids so the fix is a `pin:`/`include:` or a wider segment, never new writing); and `missing` (nowhere in the record — a genuine gap to earn). Reproducible facts, **no match score**. It resolves the same framing chain as `build`. Like `lint`, it always exits 0 and never gates. `/fh evaluate` persists nothing of its own: the gaps it surfaces go into `data/proof-backlog.md`, and the JD is logged as a normal `data/pipeline.yaml` `lead`.

`bullet` (`resume.mjs bullet (--file <draft.txt> | --text "…")`) is the deterministic half of `/fh two-month-test`: it lints **one** candidate evidence bullet before it's folded into the master, applying the same per-bullet checks as `lint` (`metric` / `duty` / `length` / `style`) and returning `{ text, word_count, flags, evidence_shaped }`, where `evidence_shaped` is true when there's no `metric` or `duty` flag. It reads the draft by file (keeping a pasted PR/ticket blurb out of the shell — `core/RULES.md` §9) or inline `--text`; exit 2 if neither is given, exit 3 if `--file` is missing, otherwise always exit 0. It **never gates and never writes** — the confirmed bullet reaches `config/resume.yaml` only through the diff → write → `validate` ritual, born in the master (never a `config/tailor/` overlay).

---

## `config/tailor/<entry-id>.yaml` — per-application overlays

Personal, gitignored (the whole `config/tailor/` directory). One overlay per application, where `<entry-id>` matches a row `id` in `data/pipeline.yaml`. `scripts/resume.mjs build --for <entry-id>` applies it to the master and writes `data/out/resume-<entry-id>.html`. `config/tailor.example.yaml` shows the shape.

An overlay **only selects, reorders, and re-headlines** the one audited master. It cannot introduce content — every bullet id it names must already exist in `config/resume.yaml`. This is deliberate: it keeps exactly one place any claim can live, so per-JD tailoring can never become per-JD fabrication.

```yaml
version: 1
role: fullstack             # optional; a preset from config/resume.yaml roles:
segment: product            # optional; a string or list; overrides the role's set
headline: "…"               # optional; override the headline for this JD (beats the role's)
summary: "…"                # optional; override the summary, or `false` to hide it
pin:     [mcp-server, soc2] # optional; master bullet ids floated to the top of their section
drop:    [withyhr-leads]    # optional; master bullet ids hidden for this application
include: [some-bullet-id]   # optional; force-include a bullet its segment would exclude
```

### Overlay validation (exit 1 on any violation)

1. The overlay is a mapping. Only these keys are allowed: `version`, `entry`, `role`, `segment`, `headline`, `summary`, `pin`, `drop`, `include`. A content key (`bullets`, `text`, `experience`, `projects`, `skills`) is rejected with a pointer to add the bullet to the master instead.
2. `role`/`headline` are non-empty strings; `segment` is a non-empty string or list of strings; `summary` is a string or `false`. (An unknown `role` name surfaces at build time, exit 2.)
3. `pin`/`drop`/`include` are lists of strings, and **every id must exist in the master's bullet ids**. A dangling reference is an error.

A missing overlay file for `--for <id>` is **not** an error — the build proceeds by segment alone and prints a soft note. If `<entry-id>` isn't a row in `data/pipeline.yaml`, the build still runs and nudges you to log the application.

---

## Sourcing (`scripts/source.mjs`, `/fh source`)

`source.mjs lint (--message "…" | --file <path>) [--type referral|outreach]` is the deterministic half of `/fh source`: it scans a **drafted** referral ask or outreach message against the "specific and finished" checklist and returns `{ type, word_count, flags }`. Flags: `placeholder` (unfilled template token / to-anyone salutation), `salutation` (no personal name), `role-link` (no link or job id), `proof` (no number and no link), `out` (no low-pressure out), `length` (over ~130 words for referral, ~90 for outreach). Like `resume lint`, it always exits 0 and **never gates** — a flagged ask still sends. It reads only the message text passed to it (drafts, if saved, belong in gitignored `data/`); it needs no `yaml` and touches no personal file.

`/fh source` persists nothing new: a sent ask is logged into the existing `data/pipeline.yaml` `asks` list (an input, never an `entries` application — `core/RULES.md` §3). For budget coaching it reads `pipeline.mjs metrics`, whose output now includes **`leads_by_channel`** — a map of open-lead counts (`stage: lead`, not closed) grouped by `channel`, alongside `leads_remaining` — so "fill the list to 20, tagged by channel" is visible.

---

## Lead ingestion (`scripts/leads.mjs`, `/fh leads`)

`leads.mjs ingest (--file <path> | --urls "u1,u2,…") [--pipeline <path>]` is the deterministic half of `/fh leads`: it turns a batch of pasted job URLs (one per line, optionally `url | company | role`; `#` comments and blanks ignored) into **candidate `lead` rows** to confirm and log. It returns `{ count, note?, rows, duplicates, rejected }`:

- **`rows`** — each `{ id, company, role, link, channel, stage: 'lead', closed: false, flags }`. The `id` is a unique kebab-case slug (`-N` on collision against both the tracker and earlier rows in the same batch). `channel` is always defaulted to `cold-portal` (channel is *intent*, not URL); `flags` names everything to confirm: `channel-inferred` (host is a known aggregator/board) or `channel-assumed` (unknown host); `company-guessed` / `role-guessed` (best-effort from host + path slug) or `company-missing` / `role-missing`.
- **`duplicates`** — `{ line, link, existing_id }` for URLs already in the tracker (normalized link match); **not** emitted as rows, so a lead can't be counted twice.
- **`rejected`** — `{ line, reason: 'no-link' }` for lines with no URL ("a lead IS a URL").

It reads the tracker **only** to dedup and avoid id collisions — a missing default `data/pipeline.yaml` yields an empty set plus a `note` (dedup skipped), while an explicit `--pipeline` that is missing/unparseable is an error (exit 3). It **never writes and never fabricates** (guesses are flagged, never shipped) and always exits 0 for a valid `ingest` — like every non-tracker script, it informs and prepares but does not gate. Confirmed rows reach `data/pipeline.yaml` only through `core/commands/log.md`'s diff → write → `validate` ritual; nothing new is persisted by this script.

---

## Interviews (`scripts/pipeline.mjs interviews`, `/fh loop`)

`pipeline.mjs interviews [--file <path>]` is the deterministic half of `/fh loop`: it lists the **live** interviews — entries at stage `screen` or `loop` that aren't `closed` — as `{ interviews, count }`, each `{ id, company, role, stage, rounds, last_date, days_since }` sorted stalest-first (`last_date` = the entry's most recent `history` event, so a fresh loop round is not mis-flagged stale; `days_since` = days since it; `rounds` = count of dated `loop` events). It refuses on invalid data (exit 1, like `metrics`), exits 3 on a missing file, and otherwise always exits 0. It reads the tracker only and **never writes**. It deliberately computes **no per-round conversion** — a loop is one stage, each round a dated event (`core/RULES.md` §1); the `screen_to_loop` / `loop_to_offer` arrows in `metrics` remain the only loop conversions. The interview craft (prep plan, per-round post-mortems) is persisted separately in `data/debriefs/<entry-id>.md`, never in the tracker.

`pipeline.mjs trends [--file <path>] [--max-weeks N]` reconstructs the four funnel arrows (`app_to_response`, `response_to_screen`, `screen_to_loop`, `loop_to_offer`) **as of each past week-ending date**, walking ISO weeks from the first application's week to now. It's **cumulative**, not per-week-cohort: each week recomputes the whole funnel as it stood then (`reachedAsOf` reads the `history` timeline; a row counts as closed-as-of via `closed_date`), so the resolved sample only grows and an arrow stays honest — `verdict` still marks anything under `min_sample` as `insufficient-sample` (RULES §6). Returns `{ weeks: [{ week, ending, arrows }], truncated, min_sample }`, most-recent `--max-weeks` (default 12) weeks. It informs `/fh review`'s week-6 persist-or-pivot check; reads only, refuses on invalid data (exit 1), exit 3 on a missing file, never gates.

`pipeline.mjs velocity [--file <path>]` reports **time-in-stage** and **stalls** off the `history` log. For each funnel arrow it gives the *median days* between the two dated events among entries that recorded both, plus the sample `n` — suppressing the median below `velocity_min_sample` (default 3). Separately it lists **stalls**: open (non-closed) rows at `applied`..`loop` whose most recent event is more than `stall_days` (default 21) ago, stalest-first, each `{ id, company, role, stage, days_idle }`. Time-in-stage is descriptive, not a conversion verdict, so it reads at a small sample — the strict `min_sample` gate stays on the `metrics` bottleneck arrows (RULES §6). Both thresholds are overridable in `config/baselines.yaml`. It informs `/fh review`; reads only, refuses on invalid data (exit 1), exit 3 on a missing file, never gates.

`pipeline.mjs migrate [--file <path>] [--write]` is a one-time convenience that converts an entry's legacy `dates: {stage: date}` map into the `history: [{stage, date}]` event log. Without `--write` it prints the migrated YAML as a dry run; with `--write` it rewrites the file after backing the original up to `<file>.bak` (YAML comments are not preserved). Idempotent — entries already on `history` are left untouched.

---

## `data/reviews/<ISO-week>.md`

One file per weekly review, e.g. `data/reviews/2026-W27.md`. Structure in `core/templates/review.template.md`: the five numbers (pasted verbatim from script output), an inputs-vs-targets grade table with self-reported prep hours, last week's one-change result, this week's one-change sentence, and the wins logged.

## `data/debriefs/<entry-id>.md`

One file per interview loop, keyed to an entry `id` in `data/pipeline.yaml` (the same per-id convention as `config/tailor/<entry-id>.yaml`), written by `/fh loop`. Structure in `core/templates/debrief.template.md`: a header, a **seniority-fit** line, a prep plan (the rounds this company runs, what to drill, the proof to have ready), a repeatable per-round post-mortem (what was asked, where it wobbled, a next-prep note), and an outcome line. Unparsed narrative markdown — **informational, never gated, never counted, never read by any script.** The funnel truth stays in the tracker (stage + `history`); each round also leaves a dated `{ stage: loop, date, round, note }` event in the entry's `history` (and, if useful, one terse `notes` line). Gitignored like all of `data/`.

## `data/wins.md`

Append-only. One dated bullet per win: `- YYYY-MM-DD: <text>`. Backfilled at init. The rebuttal file for slump weeks.

## `data/proof-backlog.md`

Written by `/fh proof` and `/fh init`. Graded findings from the proof audit plus remaining gaps and their fix status. Informational — never a gate.
