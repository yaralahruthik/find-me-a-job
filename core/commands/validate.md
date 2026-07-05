# /fh validate — check the tracker is clean

Run the gate and translate any problems into plain fixes.

## Steps

1. Run `node scripts/pipeline.mjs validate` from the repo root.
2. **Exit 0** — say so briefly ("Tracker is clean — N entries, M asks") and stop.
3. **Exit 1** — one or more problems. For each error line, explain it in plain language and propose the exact fix:
   - *unknown stage/channel* → the allowed set is in the message; map their word to the right enum (e.g. "phone screen" → `screen`, "Easy Apply" → `cold-portal`).
   - *stage vs latest dated stage mismatch* → either add the missing date or move the stage back to match; ask which is true.
   - *missing required field* → fill it (ask the user for the value; never invent a link or date).
   - *referral without referrer* → ask who referred them.
   - *dates out of order / future date* → correct with the user.
   - *stage moved backward / entry vanished* (regression guard) → this is deliberate only if they're fixing an earlier mistake. If so, re-run with `--accept-corrections`. If not, restore the correct stage — a rejection closes the row and keeps the stage; it never moves backward.
4. Show the YAML diff, apply on confirmation, and **re-run validate** until it exits 0. Never leave the file invalid.

## Exit 3

The file is missing or unparseable. If missing, they haven't set up — route to `/fh init`. If unparseable (a YAML syntax error), show the parser message and help fix the syntax.
