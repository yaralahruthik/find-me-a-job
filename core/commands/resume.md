# /fh resume — render a tailored resume from config/resume.yaml

Turn the structured `config/resume.yaml` into a self-contained, ATS-safe resume for a target segment. This is the **rendering** half of proof-of-work; the **grading** half lives in `core/commands/proof.md`. The two share one source of truth: `config/resume.yaml`.

This command **informs and produces**; it never gatekeeps. A thin resume still renders — a bad artifact is a finding in `data/proof-backlog.md`, not a wall.

## The source of truth

`config/resume.yaml` (gitignored, personal) is the **master career record** — everything the user has ever done, unbounded by page size; every build is a selection from it. Each bullet may carry `segments: [product, ai, …]`. A bullet with no `segments` (or an empty list) **always** appears; a tagged bullet appears only when building for one of its segments; a bullet tagged `archive` (exclusive) stays in the record but ships in **no** build — it appears only under `--segment all` (the master/audit view) or when a per-application overlay resurrects it by id with `include:`. "Cutting for space" means re-tagging to `archive` or a narrower segment — **never deleting a true bullet**; the record is how the system knows the user's full history. See `core/SCHEMA.md` for the full shape.

The renderer is opinionated so you don't have to be: a classic-serif, jakegut-style template (Charter/Times, ATS-safe) — small-caps name and section headings with rules, bold role + right-aligned dates, italic company/location row — and it **normalizes em/en dashes** (em → comma, en → hyphen) so none ship. The **Projects** section is optional and renders only if present — include it only when experience is thin or a project is extraordinary (see `proof.md` §3). A `summary` renders only when present; omit it by default and spend the space on bullets. Default section order is experience → projects → skills → education; an optional `section_order:` list reorders it (a fresh grad putting education first).

If `config/resume.yaml` doesn't exist yet, build it now: copy `config/resume.example.yaml` → `config/resume.yaml` and fill it from the user's real evidence (the `proof_points` in `config/profile.yaml` are the distilled starting set — port them in, keeping every claim true). Show the YAML before writing.

## Steps

1. **Validate the data.** `node scripts/resume.mjs validate`. If it exits non-zero, fix the YAML first — never build on malformed data. (Exit 3 = the file doesn't exist yet; go build it per above.)

2. **Lint (informs, never gates).** `node scripts/resume.mjs lint --segment <seg> --json`. Read the flags back as coaching, not commands:
   - `[duty]` — the bullet opens with a duty verb (Responsible/Worked/Helped…). Rewrite to lead with the outcome.
   - `[metric]` — the bullet has no number. Run the **metric excavation** from `core/commands/proof.md` §2 *now*. If an honest number surfaces, fold it in. If none does, leave one true sentence — **never invent a percentage to clear the flag.**
   - `[length]` — too long, or the whole doc likely runs past one page for this segment. Fix by re-tagging the weakest bullets (`archive`, or a narrower segment), never by deleting. (Linting `--segment all` never flags length — the master record is allowed to run long; the one-page bar applies to the framings you ship.)
   - `[pronoun]` / `[buzzword]` / `[references]` — first-person pronouns, self-description fluff ("team player"), or a "references on request" line; the writing standard (`core/RESUME-RULES.md` §3–4) explains each fix.
   - `[order]` / `[gap]` / `[bullets]` / `[contact]` — reverse-chronology broken, a 6-month-plus gap worth a one-line framing decision, more than 7 bullets in one role for this framing, or contact-block hygiene (missing phone, non-name-based email).
   The script does the mechanical scan; you do the honest rewriting with the user.

3. **The pre-build proofread** (`core/RESUME-RULES.md` §6). One pass over the framing being shipped: date formats consistent, tense consistent per role, bullet punctuation consistent, spelling read line by line, contact block correct (a typo'd email is a no-callback). This is agent judgment, not a script — flags inform, your read decides.

4. **Build the segment.** `node scripts/resume.mjs build --segment <seg>` (defaults to `config/profile.yaml` `target_segment` if `--segment` is omitted). Union multiple with `--segment product,backend`. Or pick a **role framing** with `--role fullstack` — a preset in `config/resume.yaml` `roles:` that bundles a headline and a segment set (the same person as "Product Engineer" vs "Full-Stack Engineer"). Add `--pdf` to render a PDF via Playwright; add `--page a4` for A4 (default Letter). Output lands in `data/out/resume-<seg-or-role>.html` (gitignored).
   - If `--pdf` reports it skipped (Playwright/browser not installed), the HTML is still written — tell the user to open it and Cmd/Ctrl+P → Save as PDF, or run `npx playwright install chromium` once to enable one-command PDFs.

5. **Report what you built.** The path(s) and how many bullets the segment included. If the segment hid a lot of bullets (including archived ones), say so — that is tailoring working, not data loss; everything hidden is still in the master.

Not sure which segment or role to build for a specific job? Run `/fh evaluate` first (`core/commands/evaluate.md`) — it reads the JD, picks the framing, and coverage-checks the JD's keywords against your resume, then hands you the exact `build` command.

## Per-application resumes (`--for`)

When the user wants a resume tuned to **one specific job**, don't fork the master. Build a thin overlay tied to that application's pipeline entry:

1. **Find or log the application.** The overlay is keyed to a `data/pipeline.yaml` entry id. If the role isn't in the tracker yet, log it first (`/fh log …`) so the resume and the funnel share one id.
2. **Author `config/tailor/<entry-id>.yaml`.** Give bullets you want to move an `id` in the master first (edit `config/resume.yaml`, show the diff). Then write the overlay — `segment`, an optional `headline`/`summary` override, and `pin`/`drop`/`include` lists of master bullet ids. Show the YAML before writing. **The overlay may only select and reorder; it can never add a bullet.** If the JD wants a claim the master can't make, that's a `data/proof-backlog.md` gap to earn — never a bullet to fabricate here.
3. **Build it.** `node scripts/resume.mjs build --for <entry-id>` (add `--pdf`). Output: `data/out/resume-<entry-id>.html`. `validate` the overlay path is implicit — a bad reference (an id not in the master, or a forbidden content key) fails the build with a clear message.
4. **Report** the path and what the overlay changed (pinned/dropped/re-headlined), so the tailoring is legible and reproducible.

Reuse across similar roles: if three JDs want the same emphasis, they can share a segment — reserve a per-application overlay for genuinely role-specific pinning. Don't manufacture twelve overlays that differ only cosmetically.

## Tailoring is honest reordering, never invention

Building for a segment reorders and hides *the user's own true bullets*. It must never add a skill they don't have, a number they didn't earn, or a keyword the work doesn't support. Lies surface at the screen. If a target JD wants something the resume can't honestly show, that is a `data/proof-backlog.md` gap to close by *doing the work*, not a bullet to fabricate.

## Close

Point the user at the artifact and the one highest-leverage fix still open in `data/proof-backlog.md`. Remind them: a sharper resume raises the response rate per application, but it never replaces volume — keep logging and applying while the artifact improves.
