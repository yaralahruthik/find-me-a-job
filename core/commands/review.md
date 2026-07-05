# /fh review — the weekly review ritual

Thirty minutes, same time every week. Four steps, then a written review file. This is where drift gets caught and exactly one change gets chosen. Grade on inputs, never outcomes.

## Step 1 — Sweep

Bring the tracker current before reading any number. Ask: *"Anything from this week not logged yet — applications sent, replies, stage changes, referral asks, rejections?"* Run each through `core/commands/log.md` behavior (honesty rules, diff, validate). A review on stale data is worthless.

## Step 2 — Read the five numbers

Run `node scripts/pipeline.mjs metrics --json` and present them via `core/commands/status.md`. If validate fails during the sweep, fix it before continuing.

## Step 3 — Grade the week on inputs

This is the only grade. Compare delivered inputs to `targets`:
- Applications and asks come from the metrics output.
- **Prep hours are self-reported** — ask the user for the week's hours (not in the tracker).

Then:
- **Hit the targets? Good week — say so plainly, whatever the inbox did.** Outcomes are the market's schedule, not this week's grade.
- **Missed them? Diagnose the miss first** (nothing else matters if inputs aren't landing): were the targets too high, did an active loop eat the week (legitimate — loops are always first priority; prep and debrief it with `/fh loop`), or did the search quietly lose to everything else (drift)? Name it honestly.
- Check **last week's review file** (`data/reviews/`) for the one change that was set. Ask how it went — and remember it usually needs ~2 weeks / 15–20 applications before it's readable, so "too early to tell" is a valid answer, not a failure.
- Watch for comfortable drift: endless resume polishing instead of asks, tutorials logged as prep, only-safe-role applications. The numbers make drift visible; name it.
- **Check `node scripts/pipeline.mjs velocity`** for time-in-stage (median days between events) and **stalls** — open rows that haven't moved in 21+ days. A stall is a concrete follow-up to sweep next week (a nudge, not a verdict); if a whole stage is slow to move, that's a candidate for the one change in Step 4.

## Step 4 — Pick exactly one change

One sentence: **"This week I am fixing X by doing Y."** If the user wants to change two or three things, **refuse to record more than one** and explain why (with three changes and one response, you learn nothing). Pick the highest-leverage one — usually the change that attacks the current bottleneck arrow, or a channel rebalance if cold-share is over the warning line (`leads_by_channel` in the metrics shows how cold the lead list itself is; `core/commands/source.md` is the tool for shifting the mix toward referrals). Note any deferred change for a future week.

## Then

- **Prompt for at least one win** and append it to `data/wins.md` (`- YYYY-MM-DD: …`). Rejections announce themselves; progress has to be written down or it evaporates.
- **Write the review file** `data/reviews/<ISO-week>.md` from `core/templates/review.template.md`, filling every slot (paste the metrics output verbatim into the five-numbers block).
- **From review #6 onward, surface the persist-or-pivot checkpoint** (see below).

## Persist or pivot (week 6+)

Only from the sixth review on, and only as a check — the tracker decides, moods don't. Run `node scripts/pipeline.mjs trends --json` and read the four funnel arrows week over week. It's **cumulative** — each week recomputes the funnel as of that week-ending, so the sample only grows; an arrow is readable only once its `n` clears the baseline sample (`core/RULES.md` §6). This longitudinal view is exactly what the one-week five numbers can't show.
- **Persist** when inputs are landing and an arrow's growing sample is climbing toward or into baseline *somewhere* (referrals converting, screens passing, loops happening). Week six is when the compounding you paid for starts arriving; changing strategy here is thrashing.
- **Pivot** only after ~6–8 weeks of honest inputs and one-change experiments, when **one arrow stays far below baseline across the accumulating sample** (a real, growing `n` — not one bad week). A pivot changes a strategic variable — segment, role width, city/remote, comp expectations, or a season spent building proof — not just more effort on a falsified strategy.

Never let the decision use how the user feels about themselves this week. Effort was never the broken variable.
