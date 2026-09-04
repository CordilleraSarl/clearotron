# providers/jx — a Latin mark, turned into native-script register candidates

Three pure modules, **one non-agentic structured turn each, per mark × lane**, on the AI program the run is
configured for. Not an agent: no tools, no MCP, no skills, no resume — one prompt in, one JSON object out,
validated at parse.

## What these lanes ARE, and what runs them ( /)

**One vendor, one billing mode, decided by the run and not by this directory.** The lanes go through
`engine.runTurn()` — the same door all fourteen agentic stages use — via
[`../../driver/engine/jx-turn.mjs`](../../driver/engine/jx-turn.mjs). Whatever program the customer configured
(`CLEAROTRON_AI`) and whatever billing mode the run is on (API key or subscription) carries these calls too.
That is the owner's standing rule — *one LLM provider only ever, API or auth, no mix* — and until 2026-08-20
these three lanes were the one place in the product that broke it: they POSTed to the Anthropic Messages API on
`ANTHROPIC_API_KEY` at a hardcoded cheap tier no matter what the rest of the run was doing.

**Which model.** The driver's tier vocabulary, not a wire model id: these lanes ask for the **cheap rung** of
whichever program is configured (`engine/CONTRACT.md` §3). On an Anthropic install that is a haiku-class model;
on a codex install it is that program's equivalent. The run receipt records the model the turn actually
served — `modelWire`, never the alias — on every `_driver/jx-completions.jsonl` row, beside the vendor and the
billing mode.

**Is the cheap rung enough?** For candidate generation it is a structured-extraction task and the tier is
defensible. **For the SERP judge and the nativeread lane it is an open question, not a settled fact** — both are
native-language *reasoning*, and no quality review has been run against a native-speaker reference. Round
21f9b0ad's zh artifacts are the sample a reviewer would judge it on. This paragraph is the honest state, and it
should be replaced by a measurement rather than by an assurance.

**No native-vendor seam, by ruling.** DeepSeek, Qwen and GLM would each add a vendor and a meter, which the
one-provider rule forecloses. If that rule changes, the seam goes where the transport is —
`engine/jx-turn.mjs` — and not back into this package.

## How an answer is trusted

The direct API forced the shape with `tool_choice` and flagged truncation with `stop_reason: "max_tokens"`. A CLI
turn can do neither, so both jobs moved into
[`src/turn-envelope.mjs`](src/turn-envelope.mjs):

- **The shape is asked for and validated**, this engine's house pattern everywhere else.
- **An answer the parser cannot read is a DEGRADE with a stated cause — never an empty result.** This is the load-
  bearing one. Every parser here answers a shape it cannot read with `[]`, so without it an unreadable judge reply
  would mean every SERP hit came back unclassified, which a report reads as *no adverse hits*.
- **An empty array IS an answer** and is believed. A model that reports nothing found is not a failure.
- **Truncation** is the engine's output-ceiling fault where the engine exposes one. `anthropic-agent` carries it
  (`stopReason`); `openai-agent` does not, so on codex the only truncation evidence is that a cut-off JSON object
  fails to parse — which the degrade above catches. The residue, stated: a codex turn that hit its ceiling *after*
  emitting a complete but short object reads as a short answer. `truncationObservable` rides every result so a
  reader can tell which kind of `ok` they are holding.

| File | The one call it makes |
|---|---|
| `src/core.js` | `generateCandidates` — mark + product context → up to `MAX_CANDIDATES` (8) native-script candidates for a lane (`zh`, `ja`, `ko`), each `phonetic`, `semantic` or `nickname`. Also owns `parseCandidates`, the closed-kind validator the fold reads. |
| `src/judge.js` | `judgeHits` — classifies hits code already fetched into the closed `HIT_CLASSES`. It never searches, and a judgment for an id the caller did not send is dropped at parse. |
| `src/nativeread.js` | `generateReadItems` — reads the code-inlined zh evidence slice and returns items in `ITEM_KINDS`. `severity_hint` is a triage hint and never sets a band. |



## What reads it

- [`../../driver/driver.config.mjs`](../../driver/driver.config.mjs) — `JX_PROVIDERS`, one entry per module
  (`completions`, `judge`, `nativeread`), each lazily imported and each handed the run's engine turn. There is no
  credential here any more: the engine's is the only one, and its absence is refused at the engine door rather
  than re-checked per lane. `CLEAROTRON_JX_FIXTURES` is still the $0 seam.
- [`../../driver/jx.mjs`](../../driver/jx.mjs) — folds the candidates onto the frozen register plan's
  transliteration axis, so they run as ordinary register work.
- [`../../driver/jx-units.mjs`](../../driver/jx-units.mjs) — the shadow units that call the judge (over hits
  retrieved by [`../serpapi/`](../serpapi/)) and the nativeread lane.
- Lane vocabularies — which script a lane accepts, which hosts are register mirrors — live in
  [`../../driver/jx-lanes.mjs`](../../driver/jx-lanes.mjs), not here.

There are no tests in this directory. `src/judge.js` and `src/nativeread.js` are driven from
[`../../driver/test/jx-p4-cores.test.mjs`](../../driver/test/jx-p4-cores.test.mjs), alongside the
[`../serpapi/`](../serpapi/) core that fetches the judge's hits. `src/core.js` — `buildCandidateRequest`,
`parseCandidates`, `generateCandidates` — is driven from
[`../../driver/test/jx-units.test.mjs`](../../driver/test/jx-units.test.mjs), which also covers lane routing and the
candidate fold. There is no `callMessagesAPI` any more: the three lanes reach a model through
`engine.runTurn()` (`driver/engine/jx-turn.mjs`), so the transport is exercised at the engine's door, not here.

## Where to start

`src/core.js`: the header, then `CANDIDATE_TOOL`. The comment above its `romanization` field is the fact the lane
turns on — where a provider's index holds only the transliteration (`capabilities.nativeScriptIndex === false`,
documented at length in [`../_shared/script-form.mjs`](../_shared/script-form.mjs)) the characters come back 0 with
no error, and a 0 reads as clean. `parseCandidates` leaves `romanization` null when the model omits it rather than
substituting the characters.

Then `../../driver/jx.mjs` for where the three units sit in a run — its `ARMS` table names which are
gated and on what.
