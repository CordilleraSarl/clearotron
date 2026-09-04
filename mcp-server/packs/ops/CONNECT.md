# Wiring an integrator agent to the ops surface

## 1. Get a token (the operator does this, once per principal)

```sh
node mcp-server/mint-token.mjs --scope ops --sub <principal-name> \
  --verbs start_run,feed_context,mark_sent,ack_event --ttl-days 30
```

- `--sub` names the principal in the audit log — one token per integration, never shared.
- `--verbs` is least privilege: the list above fits an intake+courier agent; add `stop_run` only if
  a human-confirmed halt path exists. Reads are always available to an ops token.
- **Record the printed `jti`** — writing it into the server's denylist file revokes the token, checked
  on every token verification (the operations runbook). A session already open keeps the scope it resolved at
  creation, so close it too if the revocation is urgent. Rotation of the signing secret is
  flag-day-free via the two-secret window.

## 2a. Local (same box, stdio) — trusted, no token needed

```json
"trademark-artifacts": {
  "command": "node",
  "args": ["/path/to/clearotron/mcp-server/server.mjs"],
  "env": { "CLEAROTRON_WORK_DIR": "…", "CLEAROTRON_REPORTS_DIR": "…", "CLEAROTRON_OUTBOX_DIR": "…" }
}
```

Local stdio is the full-trust surface (it can also reach what-if). Prefer it when the agent runs on
the engine's own host.

## 2b. Remote (HTTP face) — token required

Connect to `https://<mcp-host>/mcp` behind the operator's auth proxy, presenting the ops token as
either the `X-Trademark-Token` header or `?token=` on the URL. Notes:

- The session inherits the token's scope at creation; reconnect after a token change.
- Ops sessions ride their own rate bucket (default 30 req/min per principal) — a busy courier
  should batch by waking on events, not polling hot.
- `what_if_*` is never available remotely, by design.

## 3. Install the skills

Give the agent `SKILL.md` (intake + monitoring) and — if it also delivers — `COURIER.md`, as system
prompt / project instructions / an agent skill file. Wire your channel's wake-up (a webhook, a
filesystem watcher on your side, or a schedule) to trigger the courier loop; the engine's outbox
tolerates any wake cadence because the loop is idempotent.
