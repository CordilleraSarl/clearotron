# Corsearch

The register adapter for Corsearch's `supremesearch` API. Access is by a vendor-issued credential
rather than a signup form. It is
a global aggregator, so it declares no enumerable covered office set; see the ladder in
[`../README.md`](../README.md).

| File | What it is |
|---|---|
| `src/capabilities.js` | The capability contract, and the **reference copy** — signa's and clarivate's contracts point here for what the file is and why |
| `src/core.js` | Transport: the flat query language, paging, screening, phoneme expansion, the call ledger |
| ~~`src/index.js`~~ | RETIRED. It was a plugin-SDK entry for an agent platform this product does not ship: TypeBox schemas plus tool-factory registration of six`corsearch_*` tools, importing a package no `package.json` here declares. The adapter reaches this engine through `driver/engine/mcp/corsearch-server.mjs`, which is the only path any run has used |
| `test/` | Characterisation and fault-lane tests |

Environment: `CORSEARCH_SESSION_KEY` is required, and it is a **session cookie**, not a bearer token —
`core.js` sends it as `Cookie: sessionKey=…`. `src/index.js` will also take it from the gateway's
`plugins.entries.clawdi-corsearch.config.sessionKey`. There is no base-URL variable: `BASE_SEARCH`,
`BASE_DETAIL` and `BASE_IMAGE` are constants in `core.js`. The per-call ledger paths come from
`CLEAROTRON_REGISTER_CALL_LOG` / `CLEAROTRON_REGISTER_RECORD_LOG`, resolved in
[`../_shared/ledger-path.mjs`](../_shared/ledger-path.mjs) and shared with the other register adapters
(`provider:"corsearch"` is the discriminator).

Office codes are ISO passthrough with one alias, `EM`→`EU`, the inverse of Clarivate's. `offices.covered`
is `null`, which means *no declared restriction* — never "covers nothing".

What it notably cannot do, each declared as data in `src/capabilities.js`:

- **A count cannot be narrowed to live filings** (`countStatusFilter: "none"`): status arrives on the row,
  which is a screening fact, not a wire filter, so a count here is filings of every status.
- **Paging stops reaching records past ~5000** (`resultCeiling: 5000`) and it does **not** fail loud — it
  raises a `cap_warning`, which is precisely why the shared kernel carries a `pageGuard`.
- **The OR-stack is bounded by the URI, at 80 names** (`maxOrWidth: 80`): the whole query is a GET query
  string, so a wider stack is an HTTP 414. The planner must never emit a stack the executor would have to
  chunk-rescue.
- Opposition data, mark images, phoneme expansion and a public record URL are all present here. The one
  stated residual is on `nativeScriptIndex: true` — it is declared for Han, Katakana, Cyrillic and
  Greek; Arabic, Devanagari and Thai are UNDECLARED, which is a stated unknown and not a `false`.

## What reads it

- [`../../driver/register-capabilities.mjs`](../../driver/register-capabilities.mjs) imports `CAPABILITIES`
  at module load; the planner takes it as a parameter and never imports a vendor.
- [`../../driver/driver.config.mjs`](../../driver/driver.config.mjs) lazy-imports `src/core.js` for the
  in-process lanes under `credEnv: "CORSEARCH_SESSION_KEY"`, selected by
  `CLEAROTRON_DATABASE=corsearch`.
- [`../../driver/engine/mcp/corsearch-server.mjs`](../../driver/engine/mcp/corsearch-server.mjs) wraps the
  same core as a standalone MCP server, mounting all eight neutral `register_*` tools.
- Paging, counting, screening and the ledger are the shared kernel in [`../_shared/`](../_shared/);
  `core.js` spreads `CAPABILITIES.kernel` straight into it, so no literal can drift from the contract.

## Where to start

`src/capabilities.js`, and read it rather than a summary: its header states the doctrine every register
contract satisfies — a capability the provider genuinely lacks is declared `null` here so the slice defers
and discloses, and never silently degrades into a weaker search wearing the right answer's clothes. Then
`src/core.js`, beginning at `MATCH_MODE_PREFIX`: the match mode is a prefix character on a backtick-quoted
clause, and the contract's match-mode predicates are those keys unchanged. `predicates.owner` is the
exception — `owner:` is a real field clause, not a match mode. The model-facing operator vocabulary is in
[`../../driver/skills/prelim-register/providers/corsearch.md`](../../driver/skills/prelim-register/providers/corsearch.md).
