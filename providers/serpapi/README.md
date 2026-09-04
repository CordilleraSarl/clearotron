# providers/serpapi — the search-engine transport for the CJK grid

One pure module, `src/core.js`: ONE search-engine call per grid cell, code-side, with no model in the
data path. `SERP_ENGINES` is a closed table and `baidu` is its only entry — the engine the zh lane
dials — so an unknown engine throws rather than falling back to something that would still answer.

Three details in that file are load-bearing; the header records the vendor contract the first two
rest on, verified against the vendor's published contract:

- site scoping rides Baidu's `q6` parameter, never a `site:` operator inside `q`, so a mark that
  itself contains `site:` cannot re-scope the query;
- an HTTP 200 carrying an `error` that reads as "no results" is a RESULT — an empty, receiptable
  cell — while any other `error` value is a real failure;
- `api_key` is appended at call time only, so the params `buildSearchParams` returns can be written
  into a receipt as they are.

## What reads it

- [`../../driver/driver.config.mjs`](../../driver/driver.config.mjs) — `SERP_PROVIDERS.serpapi`,
  cred-guarded on `SERPAPI_API_KEY`. Absent, it answers
  `{ ok: false, cause: "SERPAPI_API_KEY absent from driver env" }` before any network call, so every
  cell gaps under one named cause instead of the grid dying.
- [`../../driver/jx-units.mjs`](../../driver/jx-units.mjs) — the only consumer. The zh platform-grid
  shadow unit (armed whenever the product carries `jxLanes` and the zh lane is live) dictates a term × platform spec, calls `searchCell`
  once per cell, and writes the result in the common-law grid-ledger shape so the existing receipts
  gates run over it verbatim. An empty cell is a `no_hit` row; a failed cell is a receipted gap.
- [`../../driver/jx-lanes.mjs`](../../driver/jx-lanes.mjs) — `SERP_LANES` decides which engine and
  which platform cells a lane dictates, and which hosts are register mirrors. Mirror hits are
  demoted there, code-side, before the judge in [`../jx/`](../jx/) ever sees them.

## Where to start

`src/core.js`, whole — it is short, and the header is the vendor contract. Then `searchCell`, the one
function the executor calls: its last lines hold the distinction the rest of the lane rests on, that
an empty cell and a failed cell are different facts.

`../../driver/test/jx-p4-cores.test.mjs` pins that behaviour, along with the per-request abort
deadline and the fact that the key never appears in the loggable params.

The lane this serves is the zh SERP grid in `../../driver/jx-units.mjs`; `../jx/README.md` says why it
exists.
