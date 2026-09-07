# Clarivate Compumark Content

The register adapter for Clarivate's Compumark Content API (`api.clarivate.com/compumark-content/api/v1`):
the capability contract and the transport core. This is an **enterprise subscription** — the credential
is issued by the vendor rather than through a signup form — and of the registers on the ladder in
[`../README.md`](../README.md) it enumerates the widest covered set: 186 registration-office codes.

| File | What it is |
|---|---|
| `src/capabilities.js` | The capability contract, plus `CLARIVATE_OFFICE_CODES` (the 186-code enum) and `CLARIVATE_OFFICE_ALIASES` |
| `src/core.js` | Transport: query building, the count probe, the single-shot search, screening, the call ledger |
| `test/` | Characterisation tests; `test/fixtures/README.md` states the provenance of the replayed probe |

Environment: `CLARIVATE_API_KEY` is required (sent as the `X-ApiKey` header). `CLARIVATE_API_BASE` is
optional and defaults to `core.js`'s `DEFAULT_BASE`. The per-call ledger paths come from
`CLEAROTRON_REGISTER_CALL_LOG` / `CLEAROTRON_REGISTER_RECORD_LOG`, resolved in
[`../_shared/ledger-path.mjs`](../_shared/ledger-path.mjs) and shared with the other register adapters
(`provider:"clarivate"` is the discriminator).

`regions[]` is **mandatory** on every request path here (`regionsRequired: true`) — unlike Corsearch, where
an absent region clause is a worldwide sweep. The office vocabulary is Compumark's own, so translation is
load-bearing: the EU register is `EM`, **not** `EU`, and the alias table also carries `UK`→`GB`,
`NL`/`BE`/`LU`→`BX` and the prose forms the driver's intake accepts. A code outside the 186 is a coverage
gap, not a filter to drop.

What it notably cannot do, each declared as data in `src/capabilities.js`:

- **Non-Latin characters are not indexed** (`nativeScriptIndex: false`) — only the transliteration is.
  Searching the characters returns 0 with no error, which is the false-clean shape, so the shared executor
  substitutes romanised terms or defers the slice.
- **Opposition state is not available** (`oppositions: false`). The vendor's schema defines the fields; `/text`
  does not populate them. A report must say "not available", never "none found".
- **No phoneme expansion** (`phonemeExpansion: false`) — the expansion surface is not available
  (HTTP 403), so `register_expand_phoneme` is deliberately not mounted rather than stubbed with a weaker
  search under the right name. `match_mode: "phonetic"` itself stays available.
- **No pagination** (`pagination: "single-shot"`): one `/search` returns the complete guid set or fails
  loud with `tooManyResults` past 30000, which is a crowd descriptor and not an error.
- **Screening costs a record fetch** (`screenSource: "billed-record-fetch"`), and because `/search` returns bare guids
  the screen call is the sole content source (`kernel.contentFromScreen`) — a screen failure is total
  content loss, never a band that ships as `enumerated`. There is also no public per-record URL.

## What reads it

- [`../../driver/register-capabilities.mjs`](../../driver/register-capabilities.mjs) imports `CAPABILITIES`
  at module load; the planner takes it as a parameter and never imports a vendor.
- [`../../driver/driver.config.mjs`](../../driver/driver.config.mjs) lazy-imports `src/core.js` for the
  in-process lanes under `credEnv: "CLARIVATE_API_KEY"`, selected by `CLEAROTRON_DATABASE=clarivate`.
- [`../../driver/engine/mcp/clarivate-server.mjs`](../../driver/engine/mcp/clarivate-server.mjs) wraps the
  same core as a standalone MCP server, mounting seven of the eight neutral `register_*` tools — the
  missing one is the phoneme expansion above.
- Paging, counting, screening and the ledger are the shared kernel in [`../_shared/`](../_shared/).

## Where to start

`src/capabilities.js`, and read it rather than a summary: every value is taken from the
canonical schema, and the header names the traps — `EU` vs `EM`, `CONTAINS` on `APPLICANT_NAME` being a
hard 400, and `cardinalityRefusal`, the third way this provider says "that would match too much". Then
`src/core.js` for how those declarations are built into requests. The model-facing operator vocabulary
lives in
[`../../driver/skills/prelim-register/providers/clarivate.md`](../../driver/skills/prelim-register/providers/clarivate.md).
