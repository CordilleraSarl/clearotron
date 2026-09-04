# providers/perplexity — the common-law and marketplace sweep

One pure module, `src/core.js`: the Perplexity Agent API surface. Depth auto-detection
(`detectPreset`), request assembly in three instruction modes (prose report, sandbox, JSON schema),
a retrying `callAgentAPI`, response formatting — and the part that carries the weight, the
DETERMINISTIC grid capture, where the driver dictates the search cells and this core reconciles what
the sandbox program actually ran against them.

Not a register. This is the unregistered-use side of a clearance, and on a clearance it is not
optional: without `PERPLEXITY_API_KEY` the run door refuses by name
(`preflightResearchCredential`, `../../driver/driver.config.mjs`) rather than searching less. A
KNOCKOUT is the exception and it is deliberate — its register half is a whole product without the
sweep, so `../../driver/pipeline-knockout.mjs` SKIPS this adapter and discloses the half it did not
run ( acceptance 6). Nothing is billed for a sweep that never runs.
(`CLEAROTRON_KNOCKOUT_SWEEP_FIXTURES` is the $0 dev route to a knockout WITH a sweep.)

The header's `index.js` and `build.js` belong to the plugin packaging this core was extracted from;
neither is in this tree. The two callers below are the whole production seam.

## What reads it

- [`../../driver/engine/mcp/perplexity-server.mjs`](../../driver/engine/mcp/perplexity-server.mjs) —
  the model-facing MCP server behind `perplexity_research`, handed to the stages that
  `toolGroupsForStage` maps to the `perplexity` group in
  [`../../driver/engine/mcp/gather-config.mjs`](../../driver/engine/mcp/gather-config.mjs): the
  common-law stages and synthesis. In grid mode it writes the ledger to the spec's `output_path`
  itself, so the grid never round-trips the model's bounded turn output.
- [`../../driver/driver.config.mjs`](../../driver/driver.config.mjs) —
  `RESEARCH_PROVIDERS.perplexity`, the code-side executor for the knockout sweep (no model in the
  data path). It reads `status` off the thrown error to decide whether a failure is an outage, which
  is why `callAgentAPI` puts the HTTP status on the error OBJECT and not only in its message.

## Where to start

`src/core.js`, from `GRID_COVERAGE_FLOOR` down. Everything above that line is ordinary transport;
from there on the file is anti-false-clean machinery, and each rule names the live failure that
bought it. `reconcileGridLedger` accounts every dictated (term × platform) cell as a cell or an
honest gap. `captureGridFromResponse` refuses a grid that came back below the coverage floor, so the
stage retries instead of writing a mostly-gaps ledger that would pass the receipts gate.
`findUnrecordedConnotationQueries` compares the dictated meaning queries by IDENTITY, because a
query silently mis-transcribed into a near-copy of itself keeps every count whole while never being
searched.

Then `test/connotation-identity.test.mjs`, which drives that last one with the real mutated strings.

| File | Role |
|---|---|
| `src/core.js` | Presets, request assembly, retry, response and sandbox formatting, the grid capture. |
| `test/connotation-identity.test.mjs` | Per-query identity of the dictated meaning sweep. |
| `test/source-is-text.test.mjs` | The grid cell key's NUL separator stays, written as an escape — a raw control byte makes `grep` skip the whole file, silently. |

The code-side executor serves the knockout sweep in `../../driver/pipeline-knockout.mjs`, which
resolves an executor in three steps — injected → fixtures dir → live — and returns a SKIP, not an
executor, when `PERPLEXITY_API_KEY` is unset (`resolveSweepExecutor`).
