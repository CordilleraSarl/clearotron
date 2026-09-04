# trademark-artifacts-mcp

An MCP server to **interrogate prelim trademark-clearance runs** — for an integrator's agent platform and for
your **own Claude** (Claude Code / Desktop) alike. One stdio binary, two consumers.

It answers three kinds of question against any run the `prelim-driver` produced:
1. **"How did you reach Y?"** — `trace` walks the full logic flow from any point (a stage, an artifact, a
   finding, the verdict) back through the stage that emitted it, its model + any failover, its inputs (with the
   sha each input had *when consumed* vs now), the per-search audit-trail rationale, the search terms + record
   URL, the skeptic escalations, and the refutation verdict that gated delivery.
2. **"Any more records for Z?"** — `list_findings` / `get_finding` / `search` over the run's structured findings
   and raw artifacts.
3. **"What if X changed?"** — a **single-step, approval-gated** what-if that re-runs one pipeline stage in a
   sandbox (the original run is never touched) and diffs it.

## Design

- **Imports the `prelim-driver` read-only** via `lib/driver.mjs` (the single coupling point). It hardcodes **no**
  artifact filename or stage name, so the driver can rename artifacts freely — the server tracks
  `paths()` / `STAGE_ORDER` automatically. It edits **no** driver, template, or deploy file.
- **Provenance from the self-describing `_driver/run.jsonl`** (each `stage` event records its own
  `inputs:[{name,sha}] → output`); the static `stageInputs()` DAG is only a cross-check.
- **Corsearch usage is recomputed live** from the ledger via the driver's `tallyRegisterCalls` (which already
  carries the `stripGatewayNs` fix), so it's correct even when a run's cached`status.json` value is stale —
  and it flags the drift.
- **The read tools write nothing and shell nothing.** Writing is a separate, scope-gated set, and a session
  only ever sees the set its scope allows (`shared/scope.mjs`): the ops verbs (`start_run`, `stop_run`,
  `feed_context`, `mark_sent`, `ack_event`) enqueue a job or settle a delivery, and `what_if_run` is the one
  tool that invokes the compute engine — it's **lazy-loaded** (so the read server never pulls
  `exceljs`/native addons), sandboxed, and gated behind a `confirmationToken` handshake.

## Tool surface

**A session sees only the tools its scope allows** — a run-scoped report link reaches the
plain-language layer, a signed-in client account adds the evidence layer and its own run lifecycle, firm
staff get every read tool, an ops token adds the write verbs it was minted for. `shared/scope.mjs` is the
one chokepoint that decides; the groups below are the whole catalogue, not any one session's menu.

Plain language: `brief` (one client-voiced briefing of a run — the start point for "what did the search find").
Read-only (single-run): `list_runs`, `get_run`, `read_artifact`, `list_findings`, `get_finding`,
`trace` (pass `shallow:true` for a fast lineage-only skeleton — skips the findings rebuild + live usage tally),
`get_telemetry`, `get_provider_usage`, `get_coverage`,
`search` (ranked, `mode` = `all` (default; every word, any order) / `any` / `phrase`),
`decision_timeline` (the run's ordered decision/verdict milestones, projected from `run.jsonl`, with a
`changedFromPrevious` SHA marker where a stage was recomputed),
`run_changes` (events-since-`T` change-feed with a poll `cursor` — MCP has no push),
`diff_artifact` (diff two versions of an artifact, where a `_history`/`_experiments` snapshot exists; honest
"nothing to diff" otherwise).
Evidence layer (what the search found and where it looked, as against how it was produced): `list_evidence`
(every register and common-law record considered), `list_searches` (every search run, including the ones that
came back empty), `get_search_coverage` (what is covered and what is still open).
Read-only (cross-run): `search_runs` (ranked search across every run — `scope` = `findings` (default) / `audit`
/ `key-artifacts` / `all-artifacts`, capped by `maxRuns`), `list_profiles` (the customer roster intake
resolves a job's `profileKey` against).
Ordering a search: `describe_options` (what this deployment offers, free) → `plan_run` (free preview; resolves
and describes the job, queues nothing) → `start_run` (enqueues, and spends once it runs), plus `stop_run` and
`feed_context` (late-bind an applicant or steer a re-run).
Delivery courier: `list_outbox_events`, `get_delivery_packet`, `mark_sent`, `ack_event`.
Gated compute: `what_if_plan` (dry-run + cost + completeness + `confirmationToken`) → `what_if_run` (executes).
Resources: `trademark://run/<runId>/<artifact>` (report, audit, narrative, registerFindings, commonLaw,
matterContext, a register axis, status.json, run.jsonl). A client principal reaches only the report here,
through the same gate `read_artifact` applies.

`runId` is `<slug>-<date>-<codename>`; most tools also accept just the **codename**.

## What-if: the handshake + the honesty guard

`what_if_plan` never spends. It returns what will re-run, the **cost prior** (the stage's last token usage),
whether the stage makes **billed** external calls, **what downstream is NOT recomputed**, and a
**completeness** verdict:
- a **late** stage (report-synthesis / synthesis) → `complete` (the re-run *is* the answer);
- an **early** stage (a search) → `partial` — you get that step's immediate output only; the risk read and the
  report downstream are **not** recomputed (a finished-report answer would need a full cascade, which is out of
  scope for v1 — see Future).

`what_if_run` takes the `confirmationToken` and re-runs the one stage in `_experiments/…` under a `prelim-exp-…`
session key (canonical bytes untouched, its billed calls keyed off-run), then diffs it against canonical.
**Live (undelivered) runs only.** Express the change with `instructions` (e.g. *"treat ACME's mark as
expired"*) and/or `model`.

## Remote HTTP face

> **The model — which face exists, who reaches it, and what each principal may do — lives in
> [`docs/CLIENT-MCP.md`](../docs/CLIENT-MCP.md), and lives there ONLY.** That page carries the faces
> table and the two client principals. This section is the operator's view of the same processes: how
> they refuse to start, and how to check one locally. Restating the model here is what produced three
> descriptions of one thing that had to be kept in step by hand — when the two disagree, the doc is
> right and this is stale.

Three entrypoints share the same tool implementations; scope decides what each caller reaches.
- **`server.mjs` (stdio)** — the trusted local surface; FULL tool set incl. the gated what-if.
- **`http-server.mjs` (Streamable HTTP)** — the REMOTE, authenticated surface a user adds to
  their chat app by URL. `what_if_*` are omitted here whatever the scope (no spend or shell remotely); a
  signed-in user with no token gets read tools only, while an ops token additionally carries the write
  verbs it was minted for. Binds loopback, so the only way in is an auth proxy that fronts it with a JWT —
  **Cloudflare Access over an Entra IdP is the reference deployment**, and any other OIDC proxy is config
  rather than code (`remote/REMOTE-SETUP.md`). The server re-validates that JWT on every request
  (RS256 / `iss` / `aud`, plus an identity gate on email domain and/or address), audit-logs, and rate-limits.
  **Fail-closed:** the dev bypass needs `TRADEMARK_MCP_AUTH_DISABLED=1` **and** `TRADEMARK_MCP_DEV=1` **and**
  a loopback host **and** a grants file — any one missing and the process refuses to start; with auth on,
  missing issuer/audience, identity gate or `TRADEMARK_MCP_ALLOWED_HOSTS` refuses too.
  `TRADEMARK_MCP_AUTH_MODE=token` is a third door with no proxy in front: a valid scoped access key on
  every request, loopback only, and mutually exclusive with the bypass.
- **`http-server-client.mjs`** — the CLIENT-facing twin, deliberately a *separate process* wired
  `clientSurface:true`, so "a client can never reach staff read-all" is a configuration fact rather than a
  branch that could be mis-flagged.

Connecting an app to either face: [`CONNECT.md`](CONNECT.md). Provisioning runbook for the hosted face,
worked through one auth proxy end to end (Cloudflare Tunnel + Access + Entra ID + systemd):
`remote/REMOTE-SETUP.md`.
Local HTTP check: `node http-smoke.mjs` — run it as a user with a generous memory ulimit; the SDK's HTTP
client pulls fetch/undici, which OOMs under a tight one.

## Test

```
npm install
npm test            # offline (fixture-backed; what-if uses injected fakes — no gateway)
node smoke.mjs      # spawns the real server and drives it over MCP against the fixture
```

## Wiring into an agent host

**1 — Any MCP-capable agent host** (stdio) — register the server with the data-plane env it needs
(substitute your own clone's path; see `.env.example` for the full set of variables):
```json
"trademark-artifacts": {
  "command": "node",
  "args": ["/path/to/clearotron/mcp-server/server.mjs"],
  "env": { "CLEAROTRON_WORK_DIR": "…", "CLEAROTRON_REPORTS_DIR": "…", "CLEAROTRON_OUTBOX_DIR": "…" }
}
```
Allow the read tools (and `what_if_plan`) on the agent — **hold `what_if_run`** off any autonomous
allowlist (the pattern that works: the agent runs `what_if_plan`, relays the cost, and only calls
`what_if_run` after an explicit human "yes"). An agent acting as the delivery courier additionally
needs the ops verbs `list_outbox_events`, `get_delivery_packet`, `mark_sent`, `ack_event` (issue it a
verb-scoped ops token — `../INSTALL.md` §8).

**2 — Deps**: `npm ci` at the repo root installs every workspace. The read path needs only
`@modelcontextprotocol/sdk`; `what_if_run` reuses the driver workspace's deps.

**3 — A different local user's Claude (Claude Code / Desktop)** — run the server AS the operator user
that owns the run-dirs + ledger:
```json
"trademark-artifacts": {
  "command": "sudo",
  "args": ["-u", "<operator>", "node", "/path/to/clearotron/mcp-server/server.mjs"]
}
```
This needs a one-time **NOPASSWD** sudoers rule so the stdio handshake isn't blocked on a prompt:
```
# /etc/sudoers.d/trademark-artifacts-mcp  (chmod 0440)
<caller> ALL=(<operator>) NOPASSWD: /usr/bin/node /path/to/clearotron/mcp-server/server.mjs
```

A gateway-side integration (the host's template block, tool allowlist and courier skill) belongs in the
integrator's own codebase rather than this one. Everything needed to write it is here: the tool surface
above, plus `../docs/INTAKE.md` and `../docs/DELIVERY.md`.

## Post-deploy verification

As the operator user from the clone: `list_runs` → `trace` on a delivered run → confirm it reaches
search terms, audit-trail rationale, model/failover, verdict. Then a `what_if_plan` on a late stage →
`what_if_run`; assert the canonical `report.md` sha is unchanged and the result lands in `_experiments/`.

## Future (documented, not built)

- **Cascade what-if** — re-run a stage **+ all downstream** into a scratch copy for a genuinely new final report
  on early changes (today's whole-tail `--from` is mutating, not sandboxed). New engine; ~a full run each.
- **`patch` what-if** — the precise *change-an-input-file* flavor needs a 1-line additive hook in the driver's
  `runExperiment` (overwrite a copied shadow input before the stage runs). Deferred to a **coordinated** driver
  change. v1 uses `instructions`/`model`, which needs no driver edit.
- **A persisted cross-run index** — `search_runs` scans findings and artifacts at query time. An index becomes
  worth building only when run count makes the O(runs×artifacts) full-text scope too slow.
- **Async / streaming `trace`** — a job model (start → poll) so a deep trace returns partial instead of timing
  out. Deferred; `shallow` covers the immediate "I'd take a fast skeleton" need. A slow deep trace is not the
  ledger read — that was measured, and the shared ledger is tiny — so a real fix needs a reproducible slow run
  to work against.
- **Semantic search** — synonym/intent matching (`conflict` ≈ `infringement`) via embeddings + a vector store.
  Out of scope for the read-only `.mjs` server; `search`/`search_runs` are ranked-lexical (`all`/`any`/`phrase`).
- **`clone_run`** — re-inflate an archived run as a live sandbox so what-if works post-delivery. First *write*
  feature; would be gated like `what_if_run`. Deferred.
