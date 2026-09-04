# Engine contract — the engine seam

Two engine adapters are implemented: `anthropic-agent` (`claude -p`) and `openai-agent` (`codex exec`).
`anthropic-agent` is the default; `CLEAROTRON_AI` selects the other.

The seam is an explicit **registry**, not a hardcode: `selectEngine()` resolves `CLEAROTRON_AI` against
the adapters `registerEngine()` holds, and an unknown value fails loud rather than running the wrong
provider. The driver orchestration (pipeline/stages/verify/retry ladder) is engine-agnostic; everything
provider-specific lives behind an adapter's `runTurn()`. Add a provider by writing a module that
implements §1's `runTurn()` contract, registering it, and selecting it via `CLEAROTRON_AI` — `runStage`
is untouched. Each provider is a full *agentic-runtime* adapter (MCP/tools/skills/streaming/resume), not
a model-name swap. Both shipped adapters are SINGLE-provider (every model id → one family's tier), and
there is no cross-provider tail on either to switch off: the failover chain is gone (§3), so
`chainEntries()` returns exactly one entry and provenance is honest by construction, not by a gate.

Where a section below is claude-specific, `openai-agent` maps the same concept: a per-run `CODEX_HOME`
config.toml for §8's gather MCP, `developer_instructions` for the WRITE_DISCIPLINE append, the `-` stdin
placeholder for §4's prompt-on-stdin, and `CLEAROTRON_AI_BILLING` for §4's auth toggle. An earlier
`gateway-bin` engine — a *runtime* rather than a provider choice — is no longer part of the seam.
Neither are the comms one-shots that used to call it directly: since every requester-facing event
is an outbox packet written by code (docs/DELIVERY.md), so this contract governs ALL compute in the
product and there is no second exec path beside it.

## 1. The normalized tuple (the return contract)

Every adapter's `runTurn()` returns one normalized tuple, and the gateway's classification/retry/warm
ladder consumes it without knowing which engine produced it ([gateway.mjs](../gateway.mjs)):

```
{
  code:       number,                // 0 = clean exit, 137 = killed, else the child's exit code
  killed:     boolean,               // process killed (timeout/stall/cancel)
  wall:       number,                // seconds
  stdout:     string,                // payload text (the stage's stdout-equivalent)
  stderr:     string,
  laneWaitMs: number,
  json:       object | null,         // synthesized envelope in the classifier's shape; every downstream
                                     // classifier (payloadText, status, embedded-fallback, timeout,
                                     // lane-wedge) reads this and works unchanged across engines
  usage:      Usage | null,          // canonical shape below; null = no tokens accounted (e.g. stall)
  sessionRef: string | null,         // opaque resume handle (claude session_id | codex thread_id)
  modelWire:  string | null,         // MODEL GAUGE — the served model id this turn observed (§3);
                                     // null = nothing was observed, never the requested alias
  signals:    { stalled?, noProgress?, hardWall?, rateLimited?, rateLimitBasis?, resetsAt?,
                resetsAtBasis?, usageStreamed?, noStreamEvents?, thought: bool|null },
                                     // THINKING GAUGE — see below.
                                     // rateLimitBasis / resetsAtBasis are the two HONESTY stamps, and
                                     // they answer different questions: the first is how the CAP was
                                     // classified, the second is where the reset CLOCK came from.
                                     // "text-parsed" on resetsAtBasis means it was read out of vendor
                                     // prose that stated no timezone, so it resolved in the running
                                     // box's zone — a reading, never a provider fact. Absent whenever
                                     // `resetsAt` is absent. (#697)
  reads:      string[] | absent,     // READS GAUGE — file paths this turn's Read tool_use blocks
                                     // opened; [] = recorded "read nothing"; key absent = engine cannot
                                     // observe reads (openai-agent) → gateway journals `reads: null`
  readsTruncated: boolean | absent,  // true = the path cap dropped at least one further distinct file
}
```

`runStage()` folds that into what the pipeline consumes — `{ok, json, attempts, text, sessionKey, …}` —
and journals usage/wall/status on the way past.

### `reads` — the reads gauge

Same doctrine as `signals.thought`: the prompt only says what documents the stage was *offered*;
`reads` records which files the turn actually *opened* (the completed `assistant` message's `tool_use`
blocks named `Read`, their `input.file_path` — presence only, never content). The three-valued outcome
is deliberate: `["…"]` = read these; `[]` = ran and read nothing (a recorded fact); gateway-journalled
`null` = the adapter cannot observe reads, so nothing is claimed. Without this record, the question
"did the stage actually open the documents it was given?" can only be answered forensically, after the
fact. MCP tool calls (register_*, band_lookup, …) are NOT reads and are deliberately outside this gauge
— they have their own code-written ledgers.

The gateway maps the tuple → `fail` strings so the **retry/warm/lane-wedge ladder is reused unchanged**
([gateway.mjs](../gateway.mjs)). The fail taxonomy is load-bearing (warm-eligibility regex, lane-wedge
skip, the deterministic ladder breaks on `model_mismatch:*` / `status_overloaded` / `rate_limited`, and
the `max_tokens_no_output` wrapper) and MUST be preserved verbatim:
`timeout | lane_wedge | embedded_fallback | nonzero_exit_<code> | unparseable_json | status_<s> |
missing_file:<f> | invalid_file:<f>:<reason>`.

## 2. Canonical Usage (pinned from live corpus + claude probe)

```
Usage { input, output, cacheRead, cacheWrite, total }
```
Consumed by `isLaneWedge` (input+output+cacheRead+cacheWrite === 0 → wedge,
[gateway.mjs](../gateway.mjs)) and the token rollup ([tokens.mjs](../tokens.mjs)).

**There is no reasoning-token field, and adding one is a contract decision rather than a mapping fix.**
No reasoning count exists anywhere in the `claude -p` payload — not in the assistant `usage`, not in
`result.usage`, not in `usage.iterations` (probed live, `claude` 2.1.193). Anthropic bills thinking
inside `output_tokens` and never breaks it out, so thinking *spend* is unrecoverable on that engine.
**codex does report one:** a live `turn.completed` on codex-cli 0.147.0 carries
`reasoning_output_tokens`, and `openai-agent`'s `mapUsage` leaves it deliberately unread — a slot that
is permanently 0 on one engine reads as "no thinking engaged" rather than "not reported". That is the
bar for adding it: canonical Usage would first have to say what the field MEANS when an engine cannot
produce it. The precedent for why that bar is there — a `reasoningTokens` slot existed once and no
adapter ever populated it, so every run rolled up `reasoning: 0`, which read as "no thinking" when it
only ever meant "unpopulated". Do not re-add it without answering that question first.

What IS observable is whether thinking **engaged**, per turn — see `signals.thought` in §1.

### `signals.thought` — the thinking gauge

`--effort <level>` is a **disposition, not a guarantee**: a live probe at `--effort high` on a trivial
prompt produced no thinking block at all. The stage tier in `stages.mjs` therefore records only what
was *requested*. `thought` records what *happened*.

| value | meaning | engine |
|---|---|---|
| `true` | a thinking block was present on the turn | anthropic-agent |
| `false` | no thinking block — thinking did not engage | anthropic-agent |
| `null` | engine does not report | openai-agent (codex vocabulary unprobed) |

**Judged on block presence + `signature`, NEVER on the block's text.** `thinking.display` defaults to
`"omitted"` on Opus 5, so an engaged block streams with a **zero-length** `thinking` string and a real
`signature`. Any implementation that reads the text will report "no thinking" on every production turn.

Detected from four independent tells, any one sufficient (belt-and-braces so a display-mode or CLI
version change cannot silently blind the gauge):
`stream_event`→`content_block_start{content_block.type:"thinking"}`,
`stream_event`→`content_block_delta{delta.type:"thinking_delta"|"signature_delta"}`,
and the terminal `assistant` message block of type `thinking`.

`false` is written **unconditionally** — unlike its `|| undefined` siblings in the signals bag — so
that "did not think" stays distinguishable from "record predates the gauge". `tokens.mjs` counts
`=== true` strictly into `thoughtTurns` per stage, so neither `null` nor a missing key inflates it.

- **anthropic-agent** (claude `result.usage`): `input_tokens→input`, `output_tokens→output`,
  `cache_read_input_tokens→cacheRead`, `cache_creation_input_tokens→cacheWrite`, `total`=sum.
- **openai-agent** (codex `turn.completed.usage`): `cached_input_tokens→cacheRead`,
  `input_tokens − cached_input_tokens→input` (codex's `input_tokens` INCLUDES the cached hits),
  `output_tokens→output`, `cache_write_input_tokens→cacheWrite`, `total`=`input_tokens + output_tokens`.

## 3. Tier abstraction (kill the provider leaks)

Stages must name **abstract tiers**, not provider aliases. Per-engine maps:

| tier | role (stage examples) | anthropic-agent (claude alias) | openai-agent (codex `-m`) |
|---|---|---|---|
| `judgment` | matter-frame, register-digest, synthesis, narrative-refutation | `claude-opus-5` (pinned) | `$CLEAROTRON_OPENAI_MODEL_JUDGMENT` |
| `sweep` | register-unit, case-law, skeptic, report-overview, report-card | `claude-sonnet-5` (pinned) | `$CLEAROTRON_OPENAI_MODEL_SWEEP` |
| `cheap` | saturation-probe | `haiku` | `$CLEAROTRON_OPENAI_MODEL_CHEAP` |

**AN UNHONOURED OVERRIDE IS AN ERROR, NOT A SUBSTITUTION** ( corruption 3, 2026-08-03). This
section used to declare two further tiers — `skeptic` → `google/gemini-3-flash-preview` and
`refutation` → `together/deepseek-ai/DeepSeek-V4-Pro` — each substituting an anthropic model on the
anthropic engine, "grade-moving, validated only in the paid A/B". The substitution never was validated
and could not be: the telemetry logged the alias that was ASKED FOR, so an arm run at gemini reported
gemini and ran sonnet. Both tiers are gone — the failover chain was deleted in and both stages
declare an anthropic tier in `STAGES` — and every engine's model map now **refuses** an alias it cannot
run (`claudeModel`, `openaiModel`). A concrete provider id passes through; anything else throws.

**Model provenance — two fields, never collapsed.** Every dispatch row (`_driver/<stage>.jsonl`) and
every `attempt` row (`_driver/run.jsonl`) carries:

| field | meaning |
|---|---|
| `modelUsed` | the REQUESTED resolution (`engine.resolveModelId(alias) ?? resolveModel(alias)`) |
| `modelActual` | the id the **wire** reported, or `null` when the stream never said one |
| `modelBasis` | `"actual"` when `modelActual` is present, `"unknown"` when it is not — never a requested value dressed as an observed one |
| `modelMismatch` | `true`/`false` when both sides name a family (`driver.config.modelFamily`), `null` when either does not |

Engines report the raw observation as `modelWire` on the tuple and judge nothing. anthropic-agent reads
`system:init.model` and each `assistant` message's `message.model` (the assistant's wins — it is what
served the call; init survives a turn killed before the first one). **codex names no served model on
any of its `--json` event types**, so openai-agent falls back to the session rollout written under this
run's own `CODEX_HOME`, filtered to rollouts this turn created; when there is none, `modelWire` stays
`null` and the record says `unknown` rather than echoing the requested id. A family mismatch fails the
turn and breaks the retry ladder (a retry re-buys the same wrong model); `CLEAROTRON_MODEL_WIRE_CHECK=0`
disarms the refusal and never the record.

**Thinking → effort remap.** Live vocabularies: claude `--effort` takes `low|medium|high|xhigh|max`
(CLI 2.1.193); codex `model_reasoning_effort` takes `minimal|low|medium|high|xhigh`.

| tier | anthropic-agent | openai-agent |
|---|---|---|
| `off` | `low` | `low` |
| `low` | `low` | `low` |
| `medium` | `medium` | `medium` |
| `adaptive` | `medium` | `medium` |
| `high` | `high` | `high` |
| `max` | `max` | `xhigh` |

`off` used to map to `minimal` on codex and `low` on claude — a whole rung apart at the bottom, so a
cross-engine effort comparison at `off` was off by one ( corruption 4a).`low` is the anthropic
floor, so codex came up to it and codex's `minimal` is deliberately unreachable from the driver's tier
vocabulary. `max` is the one sanctioned divergence: it means "this engine's top rung", and codex has no
`max`. `engine.anthropic.test.mjs` pins the two tables together and asserts that single exception.

**haiku + adaptive is forbidden** at both run start (`assertTierSanity`) and every dispatch
(`assertEffectiveTier`), on the EFFECTIVE tier rather than the declared one: Haiku 4.5 rejects adaptive
thinking and the request bounces to sonnet, so the pairing measures sonnet and records haiku. Both ways
it can arise are runtime overrides that never touch the stage table (`CLEAROTRON_STAGE_THINKING`, an
`--experiment --model`), which is why the start-of-run scan alone could not see it ( corruption 4b).

## 4. `claude -p` invocation (anthropic-agent)

```
printf '%s' "<stage message>" | claude -p    # PROMPT ON STDIN — never a `-p` argv element
  --model <alias>  --effort <level>
  --output-format stream-json --verbose --include-partial-messages
  --resume <sessionRef>            # warm CONVERSATION, not the prompt cache (§7); omit on first attempt
  --mcp-config <gather.json> --strict-mcp-config   # E3 gather tools
  --allowedTools "mcp__<srv>__<tool> ..."
  --max-budget-usd <cap>           # safety ceiling
```
- **Prompt on stdin, not argv (E2BIG fix, 2026-07-07):** the stage message is written to the child's
  stdin and stdin is then closed (EOF) — `claude -p` with no positional reads the prompt from stdin. A big
  prompt as a single `-p <msg>` argv element exceeds Linux `MAX_ARG_STRLEN` (128 KB) → `spawn E2BIG`
  (the register-unit primary-sweep inlines a 150 KB+ plan slice on a multi-class mark). Writing then
  closing stdin also supersedes the old `</dev/null` trick (which existed only to avoid a 3 s stdin wait).
- **Auth:** subscription works headless — probe showed `apiKeySource:"none"` (OAuth/keychain). The
  auth toggle is **config not code**, and it is `CLEAROTRON_AI_BILLING` (default `subscription`, the
  codex counterpart being `CLEAROTRON_AI_BILLING`). On the subscription path `spawnEnv()` STRIPS
  `ANTHROPIC_API_KEY` out of the child env even when the shared .env carries it, because a present key
  overrides OAuth — so setting the key alone leaves the child on subscription auth; only
  `CLEAROTRON_AI_BILLING=api-key` keeps it. The CLI's `--bare` would force API-key-only auth (OAuth
  never read), so it is INCOMPATIBLE with the subscription path — but this driver cannot add it and
  should not want to: `buildClaudeArgs` pushes no such flag and there is no extra-args knob, and
  `--bare` disables hooks, which would silently remove the write boundary `writeBoundarySettings()`
  installs.
- **Ambient-context suppression:** without it Claude Code injects CLAUDE.md/plugins and inflates cost +
  pollutes reasoning (probe without suppression: 5065 cache-creation + 21462 cache-read tokens of
  ambient overhead). What does it: the spawn cwd is `resolveSpawnCwd()`'s run dir or a tmpdir, never the
  driver checkout that carries a CLAUDE.md; the stage message is the controlled prompt;
  `--strict-mcp-config` bounds the tool surface; and the `--add-dir` roots have no CLAUDE.md/AGENTS.md at
  their head while `CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD` is deliberately left unset, so a
  granted root is file access without a memory auto-load. **No settings file disables
  hooks/plugins/auto-memory** — the one `--settings` payload this engine writes does the opposite and
  INSTALLS a hook, the `PreToolUse` write boundary (`writeBoundarySettings()`).
- **stream-json events:** `system:init` (model, mcp_servers, apiKeySource) → `stream_event` (partial
  deltas — the watchdog heartbeat) → `assistant` → `result:success|error` (usage, total_cost_usd,
  session_id, stop_reason). `is_error`/`subtype` → status; `stop_reason:"max_tokens"` → output-ceiling
  (the gateway mints `max_tokens_no_output`, wrapping the underlying content fault when there is one).

## 5. Stall-watchdog (every streaming adapter)

It takes a stream to watch, which is why only a streaming adapter has one: a blocking `execFile` path
sees nothing until the child exits and keeps a hard `timeoutSec+60` wall instead. The anthropic-agent streaming read loop runs **two clocks**,
and they measure different things.

**The byte clock — the stall.** `lastMove` resets on ANY streamed byte, because any byte is liveness. If
**≥120s of no streamed output** (`CLEAROTRON_STALL_MS`, or the stage's own `stallSec`) → kill the tree and
return the tuple with `killed:true, signals:{stalled:true}` → maps to `fail:"timeout"` so the existing
ladder retries. A healthy turn streams thinking + output deltas continuously, so this never clips a
slow-but-working turn. A kill with genuinely zero observed movement keeps `usage:null` — the signature
`isLaneWedge` reads — so that stall classifies as `lane_wedge` and the chain retries the whole stage.

**The no-progress ceiling — the second clock.** A turn that keeps the pipe warm without advancing
(ping/system chatter, an endless junk stream, a wedged loop) is invisible to the byte clock and would
otherwise burn to the hard wall — the shape it was added for: a synthesis SIGKILLed at its wall whose
retry did the identical work in 369s. `lastProgress` therefore resets ONLY on honest progress: token
movement (usage-bearing events, content deltas), a completed agent-loop step (`assistant`/`user`
events), or an observed write on the stage's own expected output files (`progressFiles`). It fires at
`CLEAROTRON_NO_PROGRESS_MS`, else at `max(the stall clock, a 300s floor)` (`CLEAROTRON_NO_PROGRESS_FLOOR_MS`) —
so it can never fire before the byte clock — and returns `signals:{stalled:true, noProgress:true}`. A
no-progress kill is RECORDED AS A STALL, never as "the stage needed more time": the retry policy must
not extend the budget for it.

**The hard ceiling — the third clock, and it measures ACTIVE time.** The last-resort wall fires at the
stage's timeout + 60s (`CLEAROTRON_HARD_MS` pins it; unset and with no stage timeout, 660s) — compared not
against elapsed but against elapsed MINUS tool wait, including a call still in flight. Owner ruling: a
model always delivers something or fails, so this ceiling exists for the harness's own failure modes,
and a turn waiting on a register call is working. Read on elapsed, a stage that spent 74.8% of its wall
in tool calls and one that stalled are indistinguishable; read on active time the first is a normal turn
at its normal token rate.

THIS IS NOT A RELAXATION OF WHAT BOUNDS A STUCK TURN, and the relationship is worth stating because the
two clocks above now carry that job alone. A tool call that never returns accrues no active time, so
this ceiling will never fire on it — the no-progress clock does, and tighter, because only a COMPLETED
result resets `lastProgress`. Disable that clock and an unreturned call runs forever; the arm that pins
this (`MOCK_CLAUDE_TOOL_HANG`) exists because the first cut shipped with the rule tested and the SITE
untested, and reverting the one line at the ceiling left the whole suite green.

## 6. Cost policy: tokens only

The driver tracks TOKENS ONLY: no `costUsd`/`pricedModel` in the tuple, no `priceFor`/`PRICING` table,
no USD in the per-attempt telemetry or the run rollup (`tokens.mjs`, was `cost.mjs`). Raw provider
output (claude's `result.total_cost_usd` in its own stream / a `CLEAROTRON_DUMP_JSON` capture) is left
untouched — it is the provider's record, not driver arithmetic.

## 7. Warm-resume

`sessionRef` threads back on both engines — claude `--resume <session_id>`, codex `resume <thread_id>` —
and the warm retry hands the engine the prior attempt's handle so it resumes the SAME session.

**Warm resume preserves the conversation, not the prompt cache.** A cross-process `claude -p --resume`
continues the prior work instead of redoing the stage from scratch, which is the whole value of the warm
patch. It does not preserve the prompt CACHE: the resumed turn reports `cacheRead:0` and re-`cacheWrite`s
the conversation rather than cache-reading the cold turn's write, so warm-patch keeps its CORRECTNESS
benefit and partly loses its COST benefit (cache-write @1.25× instead of cache-read @0.1×). Two things
bound that: on a subscription the per-call cost is notional, and the measurement behind it used two
unrelated toy messages rather than a real stage, so the size of the loss on a real stage is unmeasured.
On the API-key path it is upstream prompt-construction behaviour in the claude binary — there is no
engine-side flag for it.

## 8. Gather tools as MCP

A standalone `claude -p --mcp-config X --strict-mcp-config --allowedTools mcp__srv__tool` loads a
hand-rolled stdio MCP server (no SDK: ~120 lines of shared JSON-RPC scaffolding in `stdio-server.mjs`,
which also carries the started/settled tool-call log that makes a killed call a fact rather than an
inference, plus ~90–175 lines of per-vendor glue on top) that imports a gather core and round-trips a
tool call. Each core carries its own auth: corsearch=session cookie, perplexity=API key, euipo=OAuth2
client-creds. case-law stays on the oauth-mcp-bridge; EUR-Lex on claude's built-in `WebFetch` (codex has
none, so it gets the engine-local `fetch_url` server instead).

The servers live in `engine/mcp/` beside `gather-config.mjs`, which maps stage → tool groups →
mcp-config + allowedTools; `runStage` wires it for any engine that does not opt out
(`engine.usesGatherMcp !== false`, so both shipped engines are in — codex renders the same claude-shaped
mcpConfig into its per-run config.toml via `renderCodexConfigToml`). What stays lean is the closed
`TOOL_FREE_STAGES` set — no MCP, no tool-def bloat. The band-consuming JUDGMENT stages are tooled:
register-digest, placement-inquiry, narrative-refutation and synthesis all hold the read-only `band`
tools, the digest additionally holds its own `record_coverage`, and synthesis keeps `perplexity`. Creds
reach servers by ENV INHERITANCE from the engine process (none are
written into the config); only the run session key + ledger paths ride the config env, so the $0
provider-usage diff still attributes calls. Case-law = `bridge.mjs --server
courtlistener|legaldatahunter` + claude's built-in WebFetch (EUR-Lex). Each register vendor has its own
server of the same glue (corsearch, euipo, clarivate, signa, uspto-local, free-tier), and one provider
runs at a time.

The full MCP round-trip runs end to end: claude → euipo server → core → real fetch. **If every
`fetch()` fails in one environment and works in another, check the address-space limit before looking
for a code defect** — a hard `ulimit -v` (8 GB was low enough to do it) breaks undici's WASM HTTP
parser, so *any* node `fetch()` fails under it. That is universal to node+undici, not specific to these
servers.
