# providers/_shared — the register kernel

Not a provider. This is the machinery every register adapter is built FROM: an adapter supplies a capability
contract and vendor-shaped seams — a `search`, a `count`, a `screen`, a `rowScreen` — and the kernels here own the
page loop, the arithmetic, the shared vocabularies and the refusals. corsearch, clarivate, signa, euipo, uspto-local
and the free-tier composite all compose these; none of them reimplements them, and a new adapter should not either.

Two declarations in `../<provider>/src/capabilities.js` decide how the kernels behave, and `enumerate.mjs`'s header
documents both: `countProbe` (`"endpoint"` / `"cheap"` / `"none"`) says where a total comes from, and `screenSource`
(`"bulk-endpoint"` / `"billed-record-fetch"` / `"search-row"`) says whether screening a band costs extra calls.

| Module | What it owns |
|---|---|
| `enumerate.mjs` | The page loop and the completeness verdict — exactly `enumerated` or `incomplete`, never a top-N or a "good enough". The ceiling is a resource guard that yields `incomplete`, not a sufficiency decision the caller gets to make. |
| `count.mjs` | `makeCountProbe` — one call, one number, nothing fetched or screened. No path in it can produce a 0 that was not counted; a `countProbe: "none"` provider refuses instead. |
| `execute-plan.mjs` | The default plan executor: runs one axis of the frozen plan, writes the band file itself, owns the merge semantics, the `error: true` stamp and the capability-gap deferral. |
| `screen.mjs` | Pure screening over a normalized row: status classification (an unrecognized token is always `ambiguous`, never auto-dropped), all-class detection, `screenVerdict`. |
| `ledger.mjs` | `makeLedger(provider)` — the per-call and per-record JSONL writers. Every row carries a `provider` discriminator, and a telemetry failure never breaks a search. |
| `ledger-path.mjs` | The one resolver for where those ledgers live, for the writer and every reader. Resolution is by EXISTENCE over the legacy names and directories, not by name alone. |
| `http-body.mjs` | `parseJsonBody` keeps a parse failure as `parseError` instead of swallowing it, plus the two refusals built on that fact. |
| `transport-guard.mjs` | Converts a network REJECTION into the tool-error shape at the dependency seam, so one timeout degrades one query rather than killing the stage. |
| `result-shape.mjs` | Declares the neutral tools' result vocabulary. Imported by its gate test and deliberately by no core — a tool result is the model's prompt surface. |
| `script-form.mjs` | Which script a term is written in, and whether the active provider's index holds that form of it. |
| `term-shape.mjs` | Whether a string is a searchable mark term and agrees with its predicate (`{ predicate: "exact", term: "TIKI*" }` is a silent clean). |
| `territory-codes.mjs` | Display name → ISO 3166 / WIPO ST.3 code. `""` means worldwide, `null` means unknown — and never goes to the wire. |
| `provider-text.mjs` | Clips a vendor message from the MIDDLE, because the word that classifies a refusal sits at the end of the sentence. |
| `test/` | Twelve files, provider-agnostic by design — several drive every adapter's real code rather than fixtures of what we believe it returns. |

## What reads it

Every register adapter, through its core and its capability contract: the five register cores build their page loop
with `makeEnumerate`, and the free-tier composite runs on `execute-plan` and `ledger`. The driver imports the PURE
vocabularies directly, where the same rule has to hold on both sides of the provider seam —
[`../../driver/register-plan.mjs`](../../driver/register-plan.mjs) (`term-shape`, `script-form`, `territory-codes`),
with `scope-rules.mjs`, `territory-tiers.mjs`, `jx-lanes.mjs`, `variant-manifest-model.mjs`,
`form-neighbourhood.mjs` and `frame-diff-model.mjs` beside it. `register-count.mjs` takes the capability-gap
predicate from `execute-plan.mjs`, and `pipeline.mjs`, `pipeline-knockout.mjs`, `provider-usage.mjs` and
`registry-fidelity.mjs` all resolve their ledger paths through `ledger-path.mjs`.

## Where to start

`enumerate.mjs`'s header, whole: the two capability seams, the two states it can return, and why the ceiling is a
resource guard. Then `execute-plan.mjs`. `test/kernel-seams.test.mjs` covers every branch of the seam table by
driving `makeEnumerate` with injected dependencies rather than through a provider, so coverage does not depend on
which combinations the wired providers use — `countProbe: "none"` is the only setting none of them exercises. Read it
beside the header and the table above becomes executable rather than a claim.

corsearch's live pair is pinned against the real core by a golden master in that adapter's own test directory, which
does not cross into the public repository (`shared/withheld-paths.mjs` carries the entry and the reason: a replay
corpus for a subscription-only adapter answers to a credential the reader does not have). The link that used to sit
here pointed a public reader at a file that is not there.

Every module except `execute-plan.mjs`, `ledger.mjs` and `ledger-path.mjs` is pure — no node imports, no vendor HTTP
— which is what lets the driver import them freely and the tests run offline.
