# driver/skills — engine input, not documentation

**Every file here is prompt payload served to the model at runtime.** A stage is one engine turn told to read named
files and follow them exactly, so an edit for brevity or tone changes what a clearance concludes —
`prelim-search/synthesis-rules.md` is 1,025 lines of program. Never touch this tree in a documentation or tidy-up
task, and never let a mass edit reach it — the [ADR-0005](../../docs/decisions/0005-comments-carry-reasoning.md)
comment sweep is required to exclude this tree, and that script does not exist yet, so nothing enforces it but you.

> **Part of the tree is under an identifier hold, and a find-and-replace makes it worse.** Real delivered marks sit
> in the worked examples; renaming a candidate leaves the real conflicts found against it attached to a mark none of
> their owners holds, turning a true analysis into a false public claim about named firms. **Do not "finish the
> rename."** The ruled fix is to rebuild each example whole — a fictional candidate searched against real register
> data, the way `examples/sample-run` was built. The ruling is stated here rather than only pointed at:
> [`AGENTS.md`](../../AGENTS.md) carries it too, and ADR-0005 wants it in more than one place precisely
> because no script enforces it. A rule whose only statement is a link is a rule a reader can lose.

## What a skill directory holds

One directory per skill. `SKILL.md` is the entry point — YAML frontmatter (`name`, `description`) then the
procedure. Every other file beside it is a reference the SKILL.md or the stage message names explicitly, with six
exceptions: the four `risk-framework*.manifest.json` sidecars, whose paths the code DERIVES from the deck
(`manifestPathFor()`, `../framework.mjs`) so validators and the renderer read band vocabulary without parsing prose;
`prelim-search/risk-framework-triage.md`, the knockout lane's default ladder, named in code only
(`../pipeline-knockout.mjs`) because the knockout stage message hands the seat the frozen `_driver/framework.json`
instead; and `prelim-search/templates/search-request-form.html`, named only in `../publish/index.mjs`.

| Skill | What the stage does |
|---|---|
| `matter-frame` | Phase 0. Writes the matter's commercial context — sector, customer base, channels of trade, jurisdictions that materially matter, off-field sectors, watchlist seeds — before any search runs. `watchlist-reference.md` is enrichment, not authority. |
| `prelim-variants` | Classifies the mark into one of six archetypes, derives a risk theory from that, emits the variant manifest both execution skills read. Non-Latin scripts: `transliteration-scripts.md`. |
| `blind-frame`, `frame-diff` | Re-derives the threat model from the raw instruction alone, deliberately starved of the matter frame, then diffs that model against what the run actually scoped and emits reopen directives the driver acts on. Something has to test the frame instead of reasoning inside it. |
| `prelim-common-law` | The marketplace / web / social sweep, as structured Perplexity research over the platform list the stage dictates. Prompt templates: `perplexity-prompts.md`. |
| `prelim-register` | Register execution in the two modes a spawn selects: `unit.md` (the funnel — enumerate one axis to completion, decide nothing) and `digest.md` (judgment over the merged band). Plus `register-recipes.md`, `status-rules.md`, `stealth-filer-indicators.md`, `providers/`. |
| `placement-inquiry` | Applies commercial relevance per candidate — headline-candidate / sheet-2 / watchlist-annex / out-of-scope-filtered — before any tiering runs. |
| `case-law-citation` | Grounds risk-relevant findings in precedent fetched in-session, never from memory. One thin adapter per source in `sources/`; `evals.md` defines what working means. |
| `narrative-refutation` | Reads the finished narrative against the underlying findings files and returns CLEAR / CONDITIONAL / BLOCKING with itemised flags. Delivery is gated on the verdict. |
| `prelim-search` | The doctrine the synthesis and delivery stages are held to: `synthesis-rules.md`, the `risk-framework*.md` ladders with their `.manifest.json` band vocabularies, `delivery-contract.md`, `report-prose.md`, `worked-examples.md`, `phase2-execution.md`, `field-doctrine-pharma.md`. |
| `knockout-frame`, `knockout-assess` | Stages A and C of the knockout doctrine — a broad kill/no-kill triage screen over several candidate names at once (Stage B is a code-side research sweep). Not a clearance. |

## What reads it

- `../stages.mjs` — the per-stage table. `skillReads` names the files a stage must read; `reads()` turns them into
  the `First, read and follow exactly: …` line at the head of the stage message.
- `../engine/anthropic-agent.mjs` — `absolutizeSkillRefs()` rewrites each `skills/…` reference to an absolute path,
  and `buildClaudeArgs()` grants the tree with `--add-dir`. That flag has no read-only form, so read-only intent is
  enforced by the PreToolUse hook `../engine/deny-authority-write.mjs`, then swept by `../stray-artifacts.mjs`.
- `../driver.config.mjs` — `resolveSkillPath()`. Resolution is OVERLAY over BASE: a deployment's config store
  (`CLEAROTRON_INSTRUCTIONS_DIR`) wins per file, this tree is the fallback, and a configured-but-unreadable overlay throws
  rather than silently falling back to the Generic defaults.
- `../methodology-witness.mjs` — records the sha of every file each stage read, per run.
- `../test/skill-contract-enumerations.test.mjs` and `../test/prose-voice.test.mjs` read these files rather than a
  copy: what a skill teaches vs. what the code enforces, and the house prose contract.

## The provider boundary

Operator syntax and vendor tool tokens like `corsearch_*` live only in `prelim-register/providers/`; the spine names
the `register_*` tools, whichever vendor `CLEAROTRON_DATABASE` selects.
`../test/provider-neutral-prose.test.mjs` holds three of that boundary's lines: no vendor-prefixed tool token
outside `providers/` and the `engine/mcp/<provider>-server.mjs` glue; no provider record host in a provider-agnostic
skill file (banned hosts are read FROM the provider docs, so a sixth provider is covered the day its doc lands);
every register server registering only `register_*`, under the MCP name `register`. Field paths are the open edge —
the matcher requires `<vendor>_` and cannot see camelCase, so no test fails on one, and
`prelim-register/status-rules.md` still instructs off Corsearch's own field names (`corsearchStatusCode`,
`onomaticsJurisdictionsStatuses`, the `owners[0].*` owner chain), plus one line of `register-recipes.md` off
`onomaticsOppositions[]`. `prelim-register/SKILL.md`, `unit.md`, `digest.md` and everything under `prelim-search/`
are clean. The authoring rules and the empirical-verification checklist a new provider doc must pass sit in
`prelim-register/providers/README.md`.

## Where to start

`prelim-search/SKILL.md` — the orchestrator's own skill, and the one file describing the whole workflow end to end.
Then `prelim-register/SKILL.md`, the more elaborated of the two execution skills: a spine plus per-mode files
(`unit.md`, `digest.md`) and per-provider files (`providers/`). The other, `prelim-common-law`, is one spine plus
`perplexity-prompts.md`, its two grid modes (deterministic `grid_spec_path` dispatch vs. the legacy authored
program) being sections inside it — the per-mode split and `providers/` are register-only, not a shape every
execution skill shares. `prelim-search/phase2-execution.md` is methodology, not sequencing — the pipeline is
sequenced in code, in `../stages.mjs` and `../pipeline.mjs`.
