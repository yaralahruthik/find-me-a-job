# /fh status — this week's five numbers

A thirty-second read. Numbers come from the script, rendered faithfully. No coaching, no diagnosis beyond what the script reports — that's what `/fh review` is for.

## Steps

1. Run `node scripts/pipeline.mjs metrics --json` from the repo root. (Pass `--week YYYY-Www` only if the user asked for a specific week.)

2. **If it exits non-zero**, the data is invalid or missing. Do **not** improvise numbers. Route to `core/commands/validate.md` (or tell them to run `/fh init` if the file is missing) and stop.

3. **Render the five numbers** from the JSON, verbatim in meaning — never recompute or "adjust":
   1. **Applications this week by channel** (vs the applications target).
   2. **Referral asks and outreach messages** this week (vs their targets).
   3. **Response rate by channel, cumulative** — each with its n, its baseline range, and the script's verdict (`in-range` / `below` / `above` / `insufficient-sample`). Show the human-readable `metrics` table if that's clearer than restating JSON.
   4. **Bottleneck arrow** — exactly what the script says. If it reports "samples too small … volume", say that; do not name a bottleneck the script didn't.
   5. **Leads remaining.**

4. Surface the **cold-share warning** only if the script set it.

5. At most **one** short factual note (e.g. "no arrow has 20 results yet, so nothing's diagnosable — this week is about volume"). Then stop. Resist adding more; a status people dread is a dead status.

The simplest correct implementation is to run `node scripts/pipeline.mjs metrics` (human output) and show it, then read the `--json` if you need a specific field. Either way, the numbers are the script's, not yours.
