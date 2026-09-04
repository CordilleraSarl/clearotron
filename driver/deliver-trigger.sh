#!/bin/bash
# Outbox wake for the OPENCLAW-ADJACENT reference integration (paired with prelim-outbox.path/.service/.timer).
#
# v2 (pure-MCP courier, docs/DELIVERY.md): the outbox carries EVERY requester-facing event — delivered
# markers (body = the forwarding agent id) AND self-contained JSON packets (run-failed / intake-rejected /
# duplicate-skipped / late-bind-ack, each with an "agent" field). For each DISTINCT agent named across
# pending events, wake it ONCE to run the prelim-deliver skill, which routes everything over the ops MCP
# (list_outbox_events → get_delivery_packet → send → mark_sent/ack_event).
#
# THE TRIGGER NEVER DELETES EVENTS: consumption belongs to mark_sent (delivered) and ack_event (the rest),
# so a wake failure can never destroy an event's payload. A marker naming NO routable agent is MOVED to
# $OUTBOX/quarantine/ (payload kept, outside the .path glob) — retaining it would re-fire the path unit
# forever with no agent ever able to settle it.
#
# C5 — wake-failure detection (outbox-backoff.mjs): the wake's --json envelope is judged (nonzero exit,
# timeout, unparseable output, status!=ok, result.stopReason=="error" all count as FAILED — an
# unconditional fire-and-forget silently degraded 3 of 20 wakes in 14 days to the overnight backstop).
# A failed wake records a backoff sidecar in $OUTBOX/backoff/ (outside the .path glob); the shell paces
# the level-triggered .path re-fire by sleeping the shortest backoff. Events are retained in EVERY
# verdict (ok = the courier is consuming them; giveup = the sidecar's long cooldown gates re-wakes and
# the prelim-outbox.timer rescan owns the delivery at a sane cadence).
set -u

# #774 — this fallback chain MIRRORS driver.config.mjs (`outboxDir` = CLEAROTRON_OUTBOX_DIR, else
# <workspaceRoot>/prelim-outbox; `workspaceRoot` = CLEAROTRON_WORK_DIR, else $HOME/trademark/workspace).
# It is a second derivation of the same answer in a language that cannot import the first, so it moves
# whenever that one does. If they disagree, the driver writes markers where this script never looks and
# delivery stops with nothing in any log — the shape prelim-outbox.path already has.
OUTBOX="${CLEAROTRON_OUTBOX_DIR:-${CLEAROTRON_WORK_DIR:-${OPENCLAW_HOME:-$HOME}/trademark/workspace}/prelim-outbox}"
OPENCLAW="$(command -v openclaw || echo "${OPENCLAW_HOME:-$HOME}/.npm-global/bin/openclaw")"
HELPER="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/outbox-backoff.mjs"
DRAIN_WAIT="${CLEAROTRON_OUTBOX_DRAIN_WAIT:-180}"
# The courier wake is clerical (read outbox → send VERBATIM → mark_sent/ack_event), so run it on the cheap
# cataloged model rather than the agent's Sonnet default — the biggest per-wake saving. Cataloged id
# (openclaw models); set CLEAROTRON_OUTBOX_WAKE_MODEL="" to fall back to the agent default. `-` (not `:-`) so
# an explicit empty value disables the override, while unset keeps the Haiku default.
WAKE_MODEL="${CLEAROTRON_OUTBOX_WAKE_MODEL-anthropic/claude-haiku-4-5}"
MSG="The trademark engine's outbox has pending events. Run the prelim-deliver skill now: list_outbox_events, route each event (delivered → get_delivery_packet + send VERBATIM + mark_sent; every other kind → relay its text + ack_event)."

# THE WALL, RESOLVED ONCE AND NAMED WHEN IT IS ABSENT (#820).
#
# Every wake below runs under timeout(1) — GNU coreutils, not POSIX and not in a stock macOS or a
# slim container. Without it `timeout …` is simply a command that is not there: bash answers 127, and
# because this script runs under `set -u` and NOT `set -e`, it sails straight on. outbox-backoff.mjs
# then judges 127 the way it judges any nonzero exit and records `nonzero_exit_127` — a WAKE FAILURE.
# So the operator reads "wake for clawdi failed" in the journal, goes looking at the CLI, at auth, at
# the agent, and the answer is that a package is missing on the box. Deliveries stop, backoff climbs,
# every diagnosis points somewhere real and wrong. That is the silent class this repo keeps paying
# for, so it is turned into one sentence that names the cause.
#
# It REFUSES rather than waking bare. The wall is not decoration: the 2026-07-04 incident was a wake
# whose turn finished while the process idled 19h and wedged the lane, which the CLI's own --timeout
# did not prevent. A wake with no wall can repeat that, and this script's whole safety story is that
# it never deletes an event — a wedged lane it cannot kill is strictly worse than a delivery that
# waits for someone to install coreutils. Events are retained either way.
#
# gtimeout is accepted because that is what Homebrew's coreutils installs it as; the pacing sleep
# below still runs, so a refusal cannot hot-loop the level-triggered .path unit.
WALL="$(command -v timeout || command -v gtimeout || true)"
if [ -z "$WALL" ]; then
  echo "prelim-outbox: REFUSING TO WAKE — neither timeout(1) nor gtimeout(1) is on PATH, and every" >&2
  echo "  courier wake runs under it as an enforced wall (a wake that cannot be killed wedged this" >&2
  echo "  lane for 19h on 2026-07-04). NO event has been touched — they are all still pending and" >&2
  echo "  will deliver as soon as this is fixed. Install GNU coreutils on this host (Debian/Ubuntu:" >&2
  echo "  apt install coreutils; macOS: brew install coreutils, which provides gtimeout). This is a" >&2
  echo "  MISSING PACKAGE on the delivery host, not a failure of the agent, the CLI or the outbox." >&2
  sleep "${CLEAROTRON_OUTBOX_MAX_SLEEP_SEC:-300}"    # pace the .path re-fire — never hot-loop on a refusal
  exit 0
fi

# C5 — deterministic rescan FIRST (cheap: readdir + status.json of unsettled runs only). On a timer fire
# this is what creates the work; on a marker fire it is a free consistency pass. Failure-tolerant.
node "$HELPER" rescan || echo "prelim-outbox: rescan failed (non-fatal — existing markers still processed)"

[ -d "$OUTBOX" ] || exit 0
shopt -s nullglob
markers=("$OUTBOX"/*.pending)
[ ${#markers[@]} -gt 0 ] || exit 0

# Group markers by agent: a JSON packet carries "agent"; a legacy delivered marker's body IS the agent id.
# Validated to a safe id shape — never pass unvalidated content to the CLI.
declare -A by_agent=()
for m in "${markers[@]}"; do
  first="$(head -c 512 "$m" 2>/dev/null)"
  case "$first" in
    "{"*) a="$(printf '%s\n' "$first" | grep -o '"agent"[[:space:]]*:[[:space:]]*"[^"]*"' | head -n1 | sed 's/.*"agent"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/')" ;;
    *)    a="$(printf '%s\n' "$first" | head -n1 | tr -d '[:space:]')" ;;
  esac
  if printf '%s' "$a" | grep -qE '^[A-Za-z0-9_-]+$'; then
    by_agent["$a"]+="$m"$'\n'
  else
    echo "prelim-outbox: quarantining marker with no routable agent: $m (payload kept)"
    if mkdir -p "$OUTBOX/quarantine"; then mv -f "$m" "$OUTBOX/quarantine/" || true; fi
  fi
done
[ ${#by_agent[@]} -gt 0 ] || exit 0

min_wait=""
track_wait() {
  case "$1" in '' | *[!0-9]*) set -- 300 ;; esac   # non-numeric helper output → conservative 5m
  if [ -z "$min_wait" ] || [ "$1" -lt "$min_wait" ]; then min_wait="$1"; fi
}
woke_ok=0

for agent in "${!by_agent[@]}"; do
  # Backoff gate: inside an earlier failure's window, DON'T wake — events stay put and the sleep below
  # paces the .path re-trigger. Helper failure answers "due" (never lose a delivery).
  gate="$(node "$HELPER" check "$agent" || echo due)"
  if [ "${gate%% *}" = "wait" ]; then
    echo "prelim-outbox: $agent in backoff (${gate#wait } s left) — events retained, not waking"
    track_wait "${gate#wait }"
    continue
  fi

  echo "prelim-outbox: waking $agent to run prelim-deliver"
  # timeout(1) is the enforced wall: the 2026-07-04 incident proved the CLI's own --timeout does not
  # guarantee process EXIT (the agent turn finished; the process idled 19h and wedged the lane).
  # SIGTERM at 840s (inside the unit's TimeoutStartSec budget so the failure is OURS and logged),
  # SIGKILL 30s later. The turn runs server-side to completion either way; since this trigger deletes
  # nothing, a killed wake just leaves the events for the re-fire.
  #
  # FRESH session per wake (was a fixed --session-key prelim-outbox): reusing ONE session meant every
  # re-fire piled onto an ever-growing transcript the model reprocessed each time — that unbounded
  # growth, not the wake count alone, is what turned a stuck marker into $200+/day (2026-07-24/25). A
  # unique key bounds each wake to the skill + this one outbox read. The circuit-breaker in
  # outbox-backoff.mjs (not session history) now owns cross-wake loop detection.
  wake_session="prelim-outbox-$(date -u +%Y%m%dT%H%M%SZ)-$$-${RANDOM}"
  model_args=()
  [ -n "$WAKE_MODEL" ] && model_args=(--model "$WAKE_MODEL")
  out="$("$WALL" --kill-after=30 840 "$OPENCLAW" agent --agent "$agent" --session-key "$wake_session" "${model_args[@]}" --message "$MSG" --json --timeout 300)"
  rc=$?

  # Judge the envelope; update the backoff sidecar. Helper failure answers "retry 300" (retain + pace).
  verdict="$(printf '%s' "$out" | node "$HELPER" settle "$agent" "$rc" || echo "retry 300")"
  case "${verdict%% *}" in
    ok)
      woke_ok=1   # courier is consuming via mark_sent/ack_event — drain-wait below
      ;;
    quarantine)
      # No-progress circuit-breaker tripped: a marker survived repeated OK-but-unconsumed wakes and was
      # set aside (moved to $OUTBOX/quarantine/, outside the .path glob) + recorded in the audit log. This
      # is the load-bearing cost stop — it ends the re-fire loop for a marker mark_sent/ack_event can never
      # settle (the 2026-07 runaway class), whatever the cause. Operator notification is integrator-owned:
      # surface stuck deliveries from the audit record / MCP read surface, not from the requester outbox.
      echo "prelim-outbox: 🚨 stuck marker(s) for $agent set aside after repeated no-progress wakes — see $OUTBOX/quarantine/STUCK-ALERTS.jsonl"
      track_wait "${verdict#* }"
      ;;
    stuck)
      # OK wake that consumed nothing — not a failure, but not progress either. Paced down toward the
      # quarantine threshold instead of hot-refiring every ~3.5min.
      echo "prelim-outbox: no delivery progress for $agent — marker retained, paced ${verdict#* }s (circuit-breaker counting toward quarantine)"
      track_wait "${verdict#* }"
      ;;
    giveup)
      echo "prelim-outbox: wake for $agent failed rc=$rc — fast retries exhausted; sidecar cooldown + rescan timer own this delivery (events retained)"
      track_wait "${verdict#* }"
      ;;
    *)
      echo "prelim-outbox: wake for $agent failed rc=$rc — events retained, backoff ${verdict#* }s"
      track_wait "${verdict#* }"
      ;;
  esac
done

# Bounded drain-wait after a successful wake: exit early once the courier consumed everything
# (mark_sent/ack_event), else fall through to the pacing sleep / path-unit re-fire. NEVER delete here.
#
# POLL FIRST, THEN WAIT (#830). `remaining` used to be assigned ONLY inside the loop body, so
# CLEAROTRON_OUTBOX_DRAIN_WAIT=0 — the value an operator sets to make delivery synchronous, which is to
# say the value they set while already chasing a late delivery — ran the body zero times and left the
# post-loop `${#remaining[@]}` reading an unset array. Under `set -u` that is an error: the echo never
# runs, and "remaining: unbound variable" goes to stderr in its place. So the one line naming how many
# events are still pending never reaches the journal, and what does reach it names a variable the
# operator never set. Same shape as the missing-timeout(1) case above: the journal names the wrong
# thing and the diagnosis goes somewhere real and wrong. (On bash 5.2 the script then carries on and
# exits 0 — an unset SCALAR aborts, an unset array length does not — so the missing line is the whole
# symptom. Do not lean on that: the line has to be there either way.)
#
# Polling before the wait also makes 0 mean what it reads as — check once, wait not at all — and
# reports the count from AFTER the full wait rather than from 5s before it.
if [ "$woke_ok" = 1 ]; then
  waited=0
  remaining=("$OUTBOX"/*.pending)
  while [ ${#remaining[@]} -gt 0 ] && [ "$waited" -lt "$DRAIN_WAIT" ]; do
    sleep 5; waited=$((waited + 5))
    remaining=("$OUTBOX"/*.pending)
  done
  [ ${#remaining[@]} -gt 0 ] || { echo "prelim-outbox: drained"; exit 0; }
  echo "prelim-outbox: ${#remaining[@]} event(s) still pending after ${DRAIN_WAIT}s"
fi

# TIGHT-LOOP GUARD (load-bearing): prelim-outbox.path is PathExistsGlob on *.pending — level-triggered,
# so any retained event re-triggers this script the instant it exits. Sleeping the shortest backoff makes
# the re-trigger cadence equal the backoff instead of a hot loop (which would burn the .path unit's
# TriggerLimit and wedge the lane). Capped per activation: CLEAROTRON_OUTBOX_MAX_SLEEP_SEC (default 300) and
# the unit's TimeoutStartSec budget (1500s — wake 870 + drain 180 + sleep ≤300 + slack).
if [ -n "$min_wait" ]; then
  cap="${CLEAROTRON_OUTBOX_MAX_SLEEP_SEC:-300}"
  budget=$((1470 - SECONDS))
  w="$min_wait"
  [ "$w" -gt "$cap" ] && w="$cap"
  [ "$w" -gt "$budget" ] && w="$budget"
  if [ "$w" -gt 0 ]; then
    echo "prelim-outbox: events retained — sleeping ${w}s so the .path re-fire matches the backoff"
    sleep "$w"
  fi
fi
exit 0
