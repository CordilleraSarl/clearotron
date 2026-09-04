# Signa — the self-serve register adapter

The register adapter for Signa (`api.signa.so`): the capability contract, the HTTP transport, and the
committed office snapshot the coverage claim is derived from. Signa is the **self-serve** register — one
API key, issued instantly from the vendor's own site, no sales call and no contract — which is why
[`../README.md`](../README.md) puts it first on the ladder.

| File | What it is |
|---|---|
| `src/capabilities.js` | The capability contract. Every value carries the probe that established it |
| `src/core.js` | Transport: request building, cursor paging, normalisation, the call ledger |
| `src/offices.generated.js` | The vendor's own `GET /v1/offices` response, committed. **Generated — do not edit by hand** |
| `test/` | Offline tests; `test/fixtures/` replays live captures so the adapter can be exercised at $0 |

Environment: `SIGNA_API_KEY` is required (the `Authorization: Bearer` token). `SIGNA_BASE_URL` is
optional and defaults to `core.js`'s `DEFAULT_BASE`, `https://api.signa.so`. The per-call ledger paths
come from `CLEAROTRON_REGISTER_CALL_LOG` / `CLEAROTRON_REGISTER_RECORD_LOG`, resolved in
[`../_shared/ledger-path.mjs`](../_shared/ledger-path.mjs) and shared with the other register adapters
(`provider:"signa"` is the discriminator). `SIGNA_FIXTURES_DIR` overrides where the mock lane loads
fixtures from.

Coverage is **derived, not hand-typed**: `SIGNA_OFFICE_KEYS` filters the snapshot to the offices the
vendor reports `live` — eleven at the snapshot's `fetched_at` — so a change in what this engine claims to
search arrives as a reviewable diff. Refresh it with
[`../../bin/signa-sync.mjs`](../../bin/signa-sync.mjs); every refusal path there exits non-zero and
leaves the existing file untouched. A territory outside the live set is a disclosed coverage gap.

What it notably cannot do, each declared as data in `src/capabilities.js`: no infix wildcard
(`wildcardInfix: null` — `contains` cannot serve the raw `*foo*` pattern, so the slice defers), no
client-supplied phoneme variants (`phonemeExpansion: false`), no public per-record URL, and exactly one
`query` per request (`maxOrWidth: 1`), so an N-name band costs N calls. An owner-scoped band cannot page
past `OWNER_SCOPED_WINDOW` (400 rows). Approximate totals saturate at 10000 and report UNKNOWN, not a count.

## What reads it

- [`../../driver/register-capabilities.mjs`](../../driver/register-capabilities.mjs) imports `CAPABILITIES`
  at module load — the contract is pure (no node imports, no vendor HTTP) so that stays free.
- [`../../driver/driver.config.mjs`](../../driver/driver.config.mjs) lazy-imports `src/core.js` for the
  in-process lanes under `credEnv: "SIGNA_API_KEY"`, selected by `CLEAROTRON_DATABASE=signa`.
- [`../../driver/engine/mcp/signa-server.mjs`](../../driver/engine/mcp/signa-server.mjs) wraps the same
  core as a standalone MCP server, mounting four tools under the neutral names `register_search`,
  `register_record_fetch`, `register_enumerate`, `register_execute_plan`. There is no batch-screen tool:
  search rows already carry status, classes and owner, so screening costs no extra call.
- **A stage reaches all four.** `REGISTER_SERVERS.signa` in
  [`../../driver/engine/mcp/gather-config.mjs`](../../driver/engine/mcp/gather-config.mjs) grants what this
  server serves, per tool with its reason — corrected, where the grant had been 2 since the days
  when this adapter really was thin and never moved as the adapter thickened. Two of the eight neutral names
  this server does not serve carry no stated reason yet (`register_image_fetch`,
  `register_propose_supplemental`); that is.
- Paging, counting, screening and the ledger are the shared kernel in [`../_shared/`](../_shared/), not
  here. `core.js` builds its enumerate and execute-plan from `CAPABILITIES.kernel`.

## Where to start

`src/capabilities.js`, and read it rather than a summary of it: its header records what was probed live,
on which date, and what is still `null` on purpose. Then `src/core.js` for how a declared predicate
reaches the wire — `toSignaParams` → `buildSearchRequest` — because "the vendor supports it" and "our
executor sends it" are two different claims. The model-facing operator vocabulary lives in
[`../../driver/skills/prelim-register/providers/signa.md`](../../driver/skills/prelim-register/providers/signa.md).
