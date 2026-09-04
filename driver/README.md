# prelim-driver — deterministic driver for the prelim-search trademark workflow

Orchestration in **code**; the LLM does only judgment leaves. Each pipeline stage is **one blocking
engine turn** (default engine: `anthropic-agent`, shelling `claude -p` per stage); fan-out/fan-in/
gating/retries happen in Node. This replaces LLM-orchestrator designs that park on a continuation
decision: a code driver **cannot park** — there is no LLM continuation decision anywhere. It IS the
deterministic fan-in barrier.

## Why this is a plain OS process, not an agent

Integrator agents should never run the compute (they typically have shell access denied, and the run
must survive their session lifecycle). The driver is a plain **UNIX process** owned by the operator
account and launched by systemd. An integrator's only role at the trigger is to **submit a job** —
either a queue file, the `enqueue` CLI, or the ops-MCP `start_run` tool (see `../docs/INTAKE.md`).
The driver then runs each judgment leaf through the configured engine adapter, where provider keys +
the gather MCP servers live.

```
integrator ──job JSON (enqueue CLI / start_run / queue file)──┐
                                                              ▼
                    systemd .path (watches every queue) ──▶ prelim-driver.service
                    systemd .timer (~90s fallback re-drain) ─▶ (same oneshot)
   └─ node runner.mjs ─▶ for each queue: claim ─▶ pipeline(job, {agent}) ─▶ runStage() ─▶
                         engine turn (`claude -p`, blocking) ─▶ leaf turn
```

## Per-agent execution (multi-queue)

A prelim job runs **as the identity that forwarded it** — derived from the queue LOCATION it was
claimed from (`<workspacePrefix><agentId>/…/queue`, see `driver.config.mjs`), so there is no
forwarder→agent map to maintain. The run-dir sits in that identity's workspace and the delivery
packet names that identity as the reply route. **Publishing stays centralized** — `publish/` writes
the report + audit into the shared pool (`config.poolRoot`, `CLEAROTRON_REPORTS_DIR`) regardless of which
identity ran it. Headless deployments with no per-agent workspaces use one explicit queue
(`CLEAROTRON_QUEUE_DIR`) instead.

## Intake and delivery are contracts, not glue

- **Intake** (`../docs/INTAKE.md`): `enqueue.mjs` CLI and the ops-MCP `start_run` tool are the two
  supported paths; both validate against `enqueue-schema.mjs` before a job lands in a queue.
- **Delivery** (`../docs/DELIVERY.md`): the driver **sends nothing**. Every requester-facing event —
  delivered report, run failure, intake rejection, duplicate skip, late-bind ack — is a
  self-contained packet in the outbox (`outbox.mjs`). Integrators consume events over the ops MCP
  (`list_outbox_events` → `get_delivery_packet` → send → `mark_sent`/`ack_event`) and never touch the
  driver's filesystem. `deliver-trigger.sh` + `systemd/prelim-outbox.*` are the reference wake-up for
  an agent-based integrator.

## Files

| File | Role |
|---|---|
| `engine/` | The swappable compute substrate (`engine/CONTRACT.md`). `anthropic-agent.mjs` is the production adapter (`claude -p`, stream-json, warm `--resume`); `registerEngine()`/`selectEngine()` key on `CLEAROTRON_AI`. `engine/mcp/` hosts the per-provider gather servers. |
| `gateway.mjs` | `runStage()` — the engine-agnostic orchestration ladder: blocking call, output parse, file-truth gating, failure classification, bounded retries (fresh session key each), warm-resume. |
| `stages.mjs` | The single per-stage table (agent/model-tier/thinking/timeout/skillReads/output/validator/message). Centralizes tiers (fixes the old cross-file drift). |
| `pipeline.mjs` | The sequence: Phase-0 (code) → fan-out (batched) → fan-in barrier → placement → digest → skeptic+escalation → synthesis → (case-law) → refutation+verdict gate → publish+outbox → archive. CLI: `node pipeline.mjs --job <file.json>`. |
| `phase0.mjs` | Pure: slug, codename (re-rolled on run-dir collision), run-dir, customer template. |
| `verify.mjs` | Structural file-truth validators + `parseVerdict` (the verdict gate). |
| `runner.mjs` | Drains **every** queue (`config.queueDirs`) **concurrently across queues** (serial within one; per-queue failure isolation); per job: atomic claim (+ claimer-pid sidecar so a live claim is never re-claimed; an orphaned claim is re-claimed next activation), run, mark `.done`/`.failed` in the origin queue. |
| `enqueue.mjs` | Headless intake CLI (validate-first, atomic; exit 0 queued / 2 validation refused it / 3 id collision — a job with this id is already queued or processing, the re-delivery no-op `start_run` mirrors / 1 anything else, including bad flags, an unreadable `--job` file and fs errors). |
| `outbox.mjs` | `writeOutboxPacket()` — atomic self-contained event packets (the delivery contract's write side). |
| `slot-lock.mjs` | Cross-process counting lock (pid:nonce slot files, mutex-gated stale reclaim). Backs the RUN-slot cap (`CLEAROTRON_MAX_CONCURRENT_RUNS`), and since nothing else: it also backed a TURN cap over an agent gateway's command lanes, which never gated COMPUTE (the engines return`laneWaitMs: 0`) and left the product with the gateway it fenced. The compute-parallelism knobs are `CLEAROTRON_GATHER_CONCURRENCY` (default 7 — the gather's MEMBER COUNT: `common-law-half` a/b/m + `register-unit` × 4, so every member gets a slot in one wave rather than leaving one to wait) × `CLEAROTRON_MAX_CONCURRENT_RUNS`. Raise via a controlled experiment first: one live matter, watching per-stage walls, `rate_limited` events, provider `took_ms`/429s and RSS. |
| `profiles.mjs` + `profiles/` | Per-customer config: `profileKey`-then-forwarder-domain resolution, derived floor/batch, the run-frozen `_driver/profile.json` sidecar. Real customer bundles load from an EXTERNAL store via `CLEAROTRON_CUSTOMERS_DIR`; the repo ships `generic` + synthetic demo customers. See `profiles/README.md`. |
| `coverage-ledger.mjs` | Machine coverage-ledger contract: strict JSON-mirror parser (token-first throws), prose parser, `REGISTER_AXES`/`decideAxes`. |
| `enqueue-schema.mjs` | Job-file shape + `validateJob`. |
| `dev-portal.mjs` | Loopback-only dev-instance UI (static pool + `/profiles/*` proxy) for dry-run testing — see `../docs/E2E.md` Tier 1b. |
| `systemd/*` | Reference units: `prelim-driver.path` (watches the queues) + `prelim-driver.timer` (fallback re-drain) → `prelim-driver.service` (oneshot drain); `prelim-outbox.*` (outbox wake). |

## Key engine facts

- The `anthropic-agent` engine shells `claude -p` per stage (stream-json, blocking to the final
  result); warm retries `--resume` the same session, fresh retries start clean — see
  `engine/CONTRACT.md §3` for the model-tier map and `§8` for runtime caveats.
- Stage identity keys are `prelim-<slug>-<codename>-<stage>`; telemetry ledgers record every attempt.
- A stage's output is judged by **file truth** (the validator on the written artifact), never by the
  engine's own success claim.
- Retries never re-dispatch the same second an attempt failed: every retry waits
  `CLEAROTRON_RETRY_BACKOFF_MS` first (default 20000; attempt 1 never waits; the wait holds no turn
  slot). Anthropic 529/overload failures are classified `status_overloaded` and stop the same-model
  ladder after ONE attempt — the chain's model cascade and the recovery park (`.postponed` +
  escalating backoff) own the re-attempt.

## Run it ($0 first, then live)

```
# offline, mock engine — full pipeline, no spend:
CLEAROTRON_AI=anthropic-agent CLEAROTRON_CLAUDE_PATH=driver/test/mock-claude.mjs \
  node driver/pipeline.mjs --job /path/to/job.json

# live (provider creds + claude auth in env):
node driver/pipeline.mjs --job /path/to/job.json
```

See `../docs/E2E.md` for the full validation ladder (offline suite → dev instance → integrator
conformance → paid run).

## Single path

prelim-search runs **only** via this driver — every intake path lands a job JSON in a queue and the
driver does the rest. There is no legacy spawn path and no enable/dormant flag. (The old
LLM-orchestrator `sessions_yield` WAIT/PROCEED/SUPPRESS machinery was stripped from
`skills/prelim-search/phase2-execution.md` — only the historical removal note at its head remains;
the file is live methodology the stages read.)
