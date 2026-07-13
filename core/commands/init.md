# /fh init — first-run onboarding

Set up a running search. This is a **conversation**, not a form dump: ask, listen, reflect back, write. Run the eight steps in this operational order (the course teaches the concepts in a different order for learning; here we order them for doing). Do a batch of file writes, run `validate`, then move on — don't wait to the end.

If `config/profile.yaml` already exists, this is a re-run: ask whether to update the profile or start fresh, and skip steps the user already completed.

Tell the user up front: *"This takes about 20–30 minutes. We'll set up your profile, look at your resume, build your tracker with your real recent history, and end with your first week's numbers. Nothing here judges you — it makes the search legible."*

## 0. Environment

Before the interview, make sure the tooling exists — the user should never have to leave the conversation for terminal setup. Run:

```
node scripts/setup.mjs --check --json
```

If `ready` is false (or the file can't run because Node is missing entirely), say what's missing in one line and run `node scripts/setup.mjs` for them — it installs the lockfile-pinned dependencies if absent and wires the pre-commit personal-data guard, nothing else; show its output. Offer `node scripts/setup.mjs --pdf` if they want one-command PDF resumes now (skippable — HTML + Cmd/Ctrl+P always works, and the tracker never needs the browser). This step never touches personal data; it only prepares tooling. Then start the interview.

## 1. Intake

Ask for their **resume and/or a LinkedIn profile export** — both is better context, either is fine, neither is OK too (we can draft positioning from conversation). Whatever they give:

- Save the originals into `config/assets/` (create it; it's gitignored). Keep the given format.
- Read them. Distill into `proof_points` for `config/profile.yaml`: concrete, checkable achievements — shipped things, numbers, named tools. These become the canonical extraction every later command reads, so we never re-parse a PDF.
- Note the `assets` list (file, type, today's date) in the profile.

If a resume is a PDF you can't read directly, ask the user to paste its text, or convert it — do not guess its contents.

**Collect contact & links now — gather as much as they'll give.** These seed the resume header (`config/resume.yaml`) later, and a resume without them is incomplete, so pull them in during intake rather than discovering the gaps at build time.

**Email and phone are required: ask until you have both, and do not finish intake without them.** A resume header must carry a callable contact route; missing contact info is a top resume mistake (`core/RESUME-RULES.md` §6.5), and `lint` flags both when absent.

The rest are nudged, never forced. Ask explicitly for each; take what exists, leave the rest honestly empty (never invent a URL or a location):

- **GitHub** (or GitLab) profile URL — the single most-expected link for an engineer.
- **Personal website / portfolio** URL.
- **Location** (city, country — or "Remote") and whether they're open to relocation/remote.
- Anything else that strengthens context: other profiles (X, personal blog, Dribbble), notable public writeups, open-source repos, a demo link for a flagship project, work authorization/visa constraints if relevant to their targets.

Pull these (plus name and any headline from the LinkedIn export) into `proof_points`/notes so step 3 can drop them straight into the resume header. If a link 404s or looks stale, flag it rather than shipping it.

## 2. Positioning

Read the rules in `core/RULES.md`, then draft a **positioning statement** *against the actual evidence you just read*, in the shape:

> I'm a [identity] who [proof], looking for [target role] at [target segment].

- Pick a **primary target segment** (`product` | `startup` | `service`) with the user; ask why that one and not the others. Optionally a secondary for volume.
- The `[proof]` slot must be filled from their real `proof_points`. If it's embarrassingly empty, say so plainly — that's the real bottleneck, and step 3 will confirm it. Do not invent proof.
- **`experience_years` is required — do not complete this step without a confirmed number.** Derive total professional experience in years from the resume's experience dates read at intake, then confirm it with the user (internships and career gaps make any derivation a guess, so confirm, never assume). A student or new grad records `0`; honest, not padded. Later commands use it to mark stretch roles (`/fh leads`), never to gate an application.
- Write `positioning_statement`, `target_segment`, `secondary_segment`, `experience_years` to `config/profile.yaml`.

## 3. Proof audit + fixes

Run the `core/commands/proof.md` playbook now, inline. It grades the resume and projects against the standard, runs the evidence-bullet rewriter and metric-excavation interrogation on weak bullets *on the spot*, and writes findings + gaps to `data/proof-backlog.md`. The `config/resume.yaml` it builds is the **master career record** — capture everything true the user has done, unbounded by page size; the renderer selects what ships per framing (`core/SCHEMA.md`). **This never blocks the rest of init** — a thin proof audit is a finding, not a gate. Fold accepted rewrites into `proof_points`.

**Decide whether a Projects section belongs.** The course teaches projects as the main event, but that is aimed at candidates with little or no work history. Be agnostic: include a Projects section **only** if the user's professional experience is thin/absent, **or** they have a genuinely extraordinary project worth its own space. If solid experience already carries the proof, omit projects entirely and fold any standout project into Experience or `interview_assets` (or keep it in the master tagged `archive`) — a Projects section under a strong work history just costs one-page real estate. Ask the user; decide together.

**Authoring style:** write bullets and the headline with plain punctuation — **no em dashes** (use commas, colons, or hyphens). The renderer normalizes them anyway, but clean source reads better and keeps `lint` quiet. The full writing standard is `core/RESUME-RULES.md`; three decisions to make here, with the user:
- **Section order:** education below experience once they have real work history; a student/new grad inverts it (`section_order: [education, …]` in `config/resume.yaml`).
- **Summary:** none by default — the one exception is a career changer, where two orienting lines earn their space.
- **Date granularity:** default is month ("Jun 2025 - Present"). Run `node scripts/resume.mjs lint --segment all --json` and look for `severity: "gap"` flags (each already names the month count and the two companies). If the history carries a gap over ~6 months, surface it plainly and **offer** years-only dates (`date_granularity: year` in `config/resume.yaml`): it renders "2025 - Present", softening the visual gap while the years stay true. That is framing, not fabrication, and a gap is a conversation, never a wall (`core/RESUME-RULES.md` §7) — never pitch it as hiding anything. Show the diff, write on yes, re-validate. No gap? Leave the month default and just mention the field exists.
- **Page budget:** default is 1 (`max_pages`), and `build` auto-trims the weakest non-pinned bullets to fit it — so a resume never silently runs onto a second page. Leave it at 1 for almost everyone; only offer `max_pages: 2` in `config/resume.yaml` if the person is genuinely senior with more than a page of strong, on-target proof (the master already has to be that deep). Mention that an application overlay can raise or lower it per JD, and `--no-trim` renders the full selection. Show the diff, write on yes, re-validate.

## 4. Tracker + 30-day backfill

- Copy `config/baselines.example.yaml` → `config/baselines.yaml` (tell them it's editable — a compass, not a scoreboard).
- Create `data/pipeline.yaml` from `core/templates/pipeline.template.yaml`.
- **Backfill the last 30 days.** Walk their memory: every application, *including the silent ones and the Easy Apply blasts* — silence is data. For each: company, role, link, channel (tag honestly), stage, dates you can establish, closed/closed_date if rejected. Apply every honesty rule from `core/RULES.md` as you go (autoreceipt ≠ response, rejection closes but keeps stage, bookmark = lead). Show the YAML and `validate` after each batch.

## 5. Seed leads

Get the lead list to **10** specific leads: role + company + link, tagged by intended channel. For every product-company lead, spend a moment on a possible referrer (alumni/ex-colleague). If they genuinely can't reach 10, **that is the finding** — record what they have, and tell them the pipeline is lead-starved and sourcing is the first job. Do not pad with vague entries.

## 6. Weekly input targets

Set `targets` in `config/profile.yaml`. Seed from `search_mode`:
- `full-time` → applications 15, referral_asks 3, outreach_messages 2, prep_hours 5
- `employed` → 7 / 2 / 2 / 3

Tell them to **deliberately undershoot their enthusiasm** — week one's job is to be completable. A target missed twice becomes evidence against yourself.

Also seed the `output` block in `config/profile.yaml` with the defaults (`layout: per-lead-folder`, `resume_filename: "{name}"`). No question needed — the defaults give every tracked application its own `data/out/<entry-id>/` folder with the resume named after the user, send-ready. Mention it in one line, and note they can switch to `layout: flat` (the old `data/out/resume-<id>.*` files) or change the `resume_filename` template if they prefer.

## 7. Cadence

- Confirm `review_day` (Sunday works for most). Suggest they put a recurring 30-minute review block, and their application batches, in their calendar as fixed blocks.
- Run `node scripts/pipeline.mjs metrics --json` and present their **first status** (render via `core/commands/status.md`). Frame it: this is the baseline, most numbers will have too-small samples, and that's fine.

## 8. Wins log

Create `data/wins.md`. Backfill it: every real win since the search began, however small — a response, a screen passed, a concept that clicked, a project shipped. This is the rebuttal file for the week six slump.

## Close

Summarize what now exists (profile, tracker with N rows, M leads, targets, first numbers, proof backlog with K items). Tell them the loop from here: log as things happen, run `/fh review` on their review day, and come back to a specific arrow when the numbers say it's broken. Remind them the whole thing is honest only if every application goes in — including the embarrassing ones.
