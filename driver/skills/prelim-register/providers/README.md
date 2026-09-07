# Provider docs — authoring guide

This directory holds one Markdown file per supported register-search provider (`corsearch.md`, `clarivate.md`, `signa.md`, `euipo.md`, `uspto-local.md`, and the composite `free-tier.md`). Each file maps the provider-agnostic concepts in [../SKILL.md](../SKILL.md) onto the provider's concrete operator vocabulary, field paths, plugin tool names, and response shapes.

The provider-agnostic [../SKILL.md](../SKILL.md) refers to these files for everything provider-specific — exact searchFields syntax, field paths, operator vocabulary, quirks. Keep that boundary clean: never let provider-specific tokens (`corsearch_*`, `clarivate_*`, `signa_*`, raw field paths like `markVerbalElementText`) leak back into SKILL.md, recipe, or rule files.

**Tool names are NOT provider-specific any more.** As of the neutral-namespace change, every register tool is `register_*` (`register_search`, `register_enumerate`, `register_execute_plan`, `register_propose_supplemental`, `register_record_fetch`, `register_batch_screen`, `register_image_fetch`, `register_expand_phoneme`), served under the MCP key `register` whichever vendor is active — see `engine/mcp/gather-config.mjs`. Skill prose, recipes and driver instructions use those names directly; a provider doc's job is the *vocabulary behind* them (what `match_mode: "phonetic"` maps to, which office codes, what the response carries), never a different tool name.

This boundary is enforced by `test/provider-neutral-prose.test.mjs` — it fails the suite if a vendor tool token appears outside this directory and the per-provider `engine/mcp/*-server.mjs` glue.

```bash
# manual equivalent
grep -rnE "corsearch_|clarivate_|signa_" ../../prelim-{register,variants,search}/*.md
# should return zero hits OUTSIDE this providers/ directory
```

## Empirical-verification checklist (mandatory for new provider docs)

When adding a new `providers/<name>.md`, **do not inherit operator / composition / filter claims by analogy from existing provider docs**. A prior provider doc was written by mirroring an existing one and inherited a composition claim that was true for the original provider and false for the new one — costing a full debug cycle and motivating this checklist.

Verify every one of the following against the new provider's LIVE API before publishing the doc:

- [ ] **Operator vocabulary** live-tested — every `match_mode` value the plugin exposes (`default`, `exact`, `phonetic`, `starts_with`, `contains`, …) confirmed to behave as documented on a known fixture
- [ ] **Multi-field composition** (AND vs OR between different searchFields entries) live-tested with a 2-field probe — e.g., `WORD_MARK = "FOO" AND APPLICANT = "BAR"` should return strictly fewer hits than either constraint alone
- [ ] **Repeated-field composition** (AND vs OR between repeated identical-name entries) live-tested with a 2-class probe — e.g., `INT_CLASS = "9"` repeated twice with different values; confirm whether result is union or intersection
- [ ] **Response envelope shape** live-tested for both `/search` (lightweight) and `/detail` or `/text` (rich) endpoints — exact top-level key (`records` / `trademarks` / `body` / etc.); whether the plugin unwraps it
- [ ] **Status filter behaviour** live-tested — does the server-side `active_only` flag work? On a known mixed sample, does it strictly drop dead records? Document the interaction with [../status-rules.md](../status-rules.md)'s invalid-but-keep-if-identical rule (the dual-sweep pattern)
- [ ] **Owner-bound search** live-tested — confirm the field name and that fuzzy matching works on common name variants; document any required exact-form quirks

Keep the completed checklist and its evidence OUT of the shipped provider doc. These files publish, and a
record of how a vendor's behaviour was discovered — probe rounds, dates, the hit counts a query returned —
is not a capability and does not belong in the tree that ships. State what the API DOES in the doc; keep
the evidence with the fixtures under the provider's own `test/` tree, which does not publish. What the doc
owes a reader is the capability and its confidence: declare an unconfirmed capability `null` (a stated
unknown), never `false` (an asserted absence).
