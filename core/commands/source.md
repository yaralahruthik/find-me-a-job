# /fh source — fill leads, draft the ask, work the referral & outreach channels

The weekly sourcing loop. Referrals are the highest-converting channel in the market (roughly 0.15–0.40 vs cold-portal's 0.01–0.05 in `config/baselines.yaml`) and the one early-career searchers most underuse, because the ask feels awkward. This command makes the ask *specific and finished* so it isn't awkward, and logs it as the weekly input it is. Aliased `outreach`.

**This informs and produces; it never gatekeeps.** A drafted ask always sends — `source.mjs lint` flags a weak draft but never blocks it. And a referral **ask is an input, never an application** (`core/RULES.md` §3): it goes in `asks`, and only becomes an `entries` row if the user actually submits.

Read `config/profile.yaml` (`target_segment`, `proof_points`) and `data/pipeline.yaml`.

## Steps

### 1. Read the channel budget

Run `node scripts/pipeline.mjs metrics --json` and report, from the script only (never your own arithmetic): referral asks and outreach messages this week vs target, the cold-share warning if present, and `leads_remaining` + `leads_by_channel`. One or two lines: where does the week stand, and is the mix too cold?

### 2. Fill and tag leads toward ~20

A pipeline starves without leads. If the open-lead count is thin, spend the session topping it up — route each new lead through `core/commands/log.md` (every lead needs a link and an honest `channel`). For a **batch** of URLs you found, `core/commands/leads.md` (`/fh leads`) ingests them into deduped, id-assigned candidate rows first. A lead-starved list can also be topped up by **naming target companies**: `/fh leads` reads a named company's careers page and lists its openings for the user to pick from. Match the channel mix to the profile's segment:
- **Product companies:** referrals first, always — alumni and ex-colleagues are the road in; cold portal supplements.
- **Startups:** direct outreach with a live project link, plus startup aggregators. Speed matters.
- **Service companies:** portals and drives carry volume; referrals still help.

For each product-company lead, spend two minutes finding a possible referrer (a LinkedIn alumni search is the fastest start) and note them.

### 3. Pick the person, in order of likelihood

People who know you (college seniors, ex-colleagues, community friends) → second-degree connections with a mutual → alumni of your college at the target → engineers whose work you can mention honestly. For strangers, expect most asks to be ignored — that is the channel working normally, not a rebuff.

### 4. Draft the ask — specific and finished

Every part earns its place (this is the ask that works):
- **The exact role and its link or job id** — zero research for the other person.
- **One true proof line** — from `config/profile.yaml` `proof_points`, or the line `/fh evaluate` surfaced for this JD. One sentence they can vouch for without embarrassment (many will paste it straight into the referral form).
- **Resume attached** — no follow-up round trip.
- **An explicit out** — "totally fine if not" makes saying yes easier too.

Outreach variant: shorter and higher-intent, led by a deployed project link (founders read their own DMs). Write with plain punctuation, no em dashes.

**Never mass-personalize.** One genuinely specific ask a day beats twenty pasted ones, in conversion and in reputation — people screenshot the pasted ones. And personalization must be **true**: never invent a mutual connection, a shared college, or a proof point to warm it up (`core/RULES.md` §8). If the warm hook isn't real, send the honest colder version.

### 5. Lint the draft

```
node scripts/source.mjs lint --type referral --file <draft.txt>   # --message "…" inline only for text you wrote
```

Write the draft to a gitignored `data/` scratch file and lint it by `--file` — pasted or externally-sourced message text must not be interpolated inline into a shell command (`core/RULES.md` §9). Read the flags as coaching, then fix what's true:
- `[salutation]` / `[placeholder]` — address one real person; strip any template token.
- `[role-link]` — add the exact role link or job id.
- `[proof]` — add one honest number or a deployed link (never invent one to clear the flag).
- `[out]` — add the low-pressure out.
- `[length]` — tighten; long asks get ignored.

It never blocks sending — a flagged ask you choose to send is still a logged input.

### 6. Send, then log

After the user sends, record it in `asks` via `core/commands/log.md`: `date`, `type` (`referral` | `outreach`), `person`, `company`, and `lead_id` tied to the pipeline entry. Two honesty calls (`core/RULES.md` §3):
- An ask is an **input**, not an application — it does not touch `entries` until a real submission happens.
- An **outreach DM that carried the resume** is *both* an ask *and* an `outreach` application (a resume went out). Ask whether the resume was attached; that decides it.

### 7. Close

Say where the budget stands vs targets, from the numbers. Reassure honestly: most stranger-asks go unanswered, and that is exactly why asks are a weekly input *with a target*, not a one-time embarrassment — you're grading the sending, not the replies (`core/RULES.md` §4). One specific ask a day keeps the highest-converting channel warm while cold volume runs underneath it.

Ties into the flow: `/fh evaluate` picks the resume framing and the proof line → `/fh source` drafts the ask that carries it → the ask lands in `asks` and the weekly numbers count it. `/fh proof` is where the proof line was made true in the first place.
