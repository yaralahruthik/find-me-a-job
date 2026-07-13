# RESUME-RULES: the resume-writing standard

*Distilled from four sources the community keeps converging on: Canada Job Bank's resume guide, Harvard FAS/MCS career services, Coursera's resume-tips article, and an r/jobs thread by a reviewer of 1000+ resumes (links at the bottom). Deduplicated, adapted for a software engineer's one-pager, and bound by `core/RULES.md` §8: nothing here ever invents a number, skill, or keyword.*

**Everything in this file informs; nothing gates.** The deterministic subset rides in `scripts/resume.mjs lint` (flags: `pronoun`, `buzzword`, `references`, `order`, `gap`, `bullets`, `contact`, alongside the original `duty`, `metric`, `length`, `style`). The rest is judgment the agent applies during `/fh proof`, `/fh resume`, and `/fh two-month-test`.

## 1. The bullet formula

Every experience bullet is an achievement, not a duty. The named shape (Harvard's "specific, active, fact-based", operationalized by the X/Y/Z formula):

> **Accomplished X, as measured by Y, by doing Z.**

Same shape as this system's *outcome + number + method*. "Cut reports load 6s to 1.8s, measured with Lighthouse, by moving filtering server-side" follows it; "Responsible for the reports page" does not. If no honest number survives the metric excavation (`proof.md` §2), one true sentence beats a fabricated percentage. (All four sources; the single most repeated rule.)

- Start with a strong, **specific** past-tense verb (present tense acceptable for the current role, but keep each role internally consistent). "Migrated", "profiled", "shipped" beat "worked on", "helped with". (Harvard, Job Bank)
- No vague claims: "improved efficiencies", "various tasks", "cutting-edge" say nothing a screen can ask about. (Job Bank, r/jobs)
- One measurable claim per bullet; `lint` flags past 32 words. (Coursera, Job Bank)

## 2. Page economy

- **One page per shipped framing.** The master record is unbounded; the artifact is not. (r/jobs, Harvard; Job Bank's two-page allowance is the outer bound, never the target.) This is the `max_pages` budget (default 1): `build` auto-trims the weakest non-pinned bullets to fit it and reports every drop, so a tailored resume never silently spills over. Raise `max_pages` to 2 for a genuinely senior role, or pin the bullets that must stay.
- **~80% of the page on the target track.** Everything else earns its lines or gets re-tagged (`archive`, or a narrower segment), never deleted from the master. (r/jobs)
- Compress or cut roles older than ~15 years. (Job Bank)
- **5 to 7 bullets per role, at most.** More dilutes the best ones; `lint` notes the excess. (Job Bank)
- Reverse-chronological order within every section; `lint` checks the dates. (Harvard, Coursera)

## 3. Section policy

- **Education below experience** once you have real work history; students and new grads invert it (set `section_order:` in `config/resume.yaml`, decided at `/fh init`). Omit high-school once a degree exists; omit GPA unless asked or exceptional. (Coursera, r/jobs)
- **No summary section by default.** The one documented exception: career changers, where two lines of "X professional moving to Y, previous proof Z" orient the reader. (r/jobs; Coursera's pro-summary advice applies to that case.)
- **Hobbies are space-filler only**, for a page that would otherwise run thin; recruiters split on them. Early-career pages fill with projects, volunteering, and coursework instead of shipping a half page. (r/jobs, Job Bank)
- Projects section policy lives in `proof.md` §3: main event for thin experience, otherwise usually not worth the lines.
- No references section and no "references available upon request"; the line buys nothing and costs a line. (Job Bank, Harvard, Coursera)

## 4. Language

- **No first-person pronouns** (I, me, my, we, our); resumes are written in implied first person. (Job Bank, Harvard)
- **No buzzword self-descriptions**: "team player", "detail-oriented", "hard-working", "results-driven", "go-getter", "passionate". Show the trait through an achievement; claiming it is what weak resumes do. (r/jobs, Harvard)
- Exact technical terms are keywords, keep them; prune internal codenames and unexplained acronyms a recruiter can't parse. (Coursera's nuance over Job Bank's blanket no-jargon rule; for SWE resumes the tech nouns are the ATS match.)

## 5. Tailoring

- Tailoring means **surfacing true-but-omitted proof**, usually the single biggest win: read the JD in depth, then pull forward the bullets and skills you already have that answer it. In this system that is exactly `coverage`'s `in_master` bucket plus an overlay `pin:`/`include:`; new writing is only for work the master genuinely supports. (r/jobs' concrete method; all four sources agree on tailoring per application.)
- Adjacent-unique skills earn their line: Java and C# are worth listing when the JD says Python, because they answer the same question honestly. Never list a skill you do not have. (Coursera)
- Never let a tool (this one included) add a keyword you lack; the overlay model makes that structurally impossible, keep it that way. (Harvard's AI guidance; `core/RULES.md` §8.)

## 6. The pre-build proofread

Before every `build` handoff, the agent runs one consistency pass over the framing being shipped:

1. **Dates**: same format everywhere, reverse-chronological, no unexplained overlaps; a visible gap over ~6 months is worth a one-line framing decision before a recruiter wonders (`lint` notes it; it is a conversation, never a wall).
2. **Tense**: past for past roles, consistent within each role.
3. **Punctuation**: bullets end consistently (all with or all without periods); no em dashes (renderer normalizes, `lint` flags).
4. **Spelling**: read every line; typos are the most-cited instant credibility hit. A second human pass is worth asking for. (Job Bank, Harvard, r/jobs)
5. **Contact block**: name, name-based email, valid phone, working links, city/region only. A typo'd email is a no-callback. (Harvard lists missing contact info in its top mistakes; r/jobs, Job Bank, Coursera)

## 7. Anti-advice on record

Advice the sources' own threads rebut, kept here so it never creeps in:

- "Stretch the dates to hide a gap" and "embellish, everyone does" were posted in the r/jobs thread and rebutted in-thread by a hiring manager: fabrication is found at reference and interview, and it voids the honest work around it. This system's law already forbids it (`core/RULES.md` §8); the market agrees.
- Keyword stuffing to beat ATS reads as noise to the human who opens the file next. Coverage facts, honest additions, earned gaps: that is the whole loop (`evaluate.md`).

## Sources

- Canada Job Bank, "How to write a good resume": https://www.jobbank.gc.ca/findajob/resources/write-good-resume
- Harvard FAS Mignone Center for Career Success, "Create a strong resume": https://careerservices.fas.harvard.edu/resources/create-a-strong-resume/
- Coursera, "Resume tips": https://www.coursera.org/in/articles/resume-tips
- r/jobs, "I've reviewed 1000+ good and bad resumes, here are my tips": https://www.reddit.com/r/jobs/comments/ijyjwk/ive_reviewed_1000_good_and_bad_resumes_here_are/
