# systemd units for a hosted deployment

The reference systemd **user** units for a server that runs the engine unattended: two event-driven lanes (drain the
job queue, wake delivery) plus the customer-profile config service. Every repo and data path is `%h`-relative. The
lane services take what differs per box from `EnvironmentFile=%h/.env`; `profile-service.service` deliberately
carries none, so the trademark CF Access AUD cannot be shadowed by another app's value in that file.

## Resolved units — the three configuration cannot reach

Most units here take what differs per box from `EnvironmentFile=%h/.env` and expand
`${CLEAROTRON_CHECKOUT_DIR}` in `ExecStart=`. **Three cannot**, each for its own reason:

| unit | why the variable cannot reach it |
|---|---|
| `prelim-driver.path` | a `.path` unit reads **no** environment — no `%E`, no `EnvironmentFile`, no expansion |
| `profile-service.service` | loads no `EnvironmentFile` on purpose: on systemd an `EnvironmentFile` **wins** over `Environment=`, so one would let `~/.env` shadow the trademark CF Access AUD |
| `courtlistener-mcp.service` | loads none for the same class of reason — one would let `~/.env` override its `PATH` |

They carry `@NAME@` placeholders, and the installer substitutes them:

```
node driver/systemd/render-units.mjs            # --check: compare the installed copies against this tree
node driver/systemd/render-units.mjs --apply    # write the resolved copies to ~/.config/systemd/user/
```

**Do not `cp` these three.** The tracked file is a template; the installed copy is resolved. Copying the
template installs a unit whose paths contain `@CLEAROTRON_CHECKOUT_DIR@` verbatim — it will fail to start
and name the placeholder, which is deliberate. A substitution scheme that degraded to something plausible
would hide exactly the case this exists for.

`render-units.mjs` **refuses rather than writing a partial unit**: if any value is unset it names every
missing one and writes nothing, because a unit with one placeholder left starts and misbehaves, which is
worse than one that does not start. Which units need it is **derived from the files**, not from a list —
and `driver/unit-inventory.mjs` declares them, with a test asserting the two agree in both directions.

These are for a **server, not a laptop**. On a workstation there is nothing to install: `npx clearotron start` supervises the
same loop for you, and`node driver/runner.mjs --watch` is what to run by hand if you started with
`--no-worker` (`INSTALL.md` §5) — one foreground process that polls for queued jobs and for parked runs whose
window has elapsed.

| File | What it does |
|---|---|
| `prelim-driver.path` | inotify watch on each agent queue; a `*.json` job there starts the drain |
| `prelim-driver.timer` | `OnUnitActiveSec=90s` fallback re-drain — the backstop when a watch never armed |
| `prelim-driver.service` | `Type=oneshot`: runs `runner.mjs`, then `flag-snapshot.mjs`. Deliberately not `[Install]`ed — the `.path` and `.timer` activate it |
| `prelim-outbox.path` | watches `*.pending` in the outbox — all five requester-facing events, not just finished runs: `delivered` (plain text, body = the forwarder agent id) plus the JSON packets `run-failed`, `intake-rejected`, `duplicate-skipped`, `late-bind-ack`. The two intake kinds are written before a run dir exists ([`../../docs/DELIVERY.md`](../../docs/DELIVERY.md)) |
| `prelim-outbox.timer` | `OnUnitActiveSec=50min` delivery rescan behind that watcher |
| `prelim-outbox.service` | `Type=oneshot`: runs `deliver-trigger.sh` to wake the forwarder agent. Also not `[Install]`ed |
| `profile-service.service` | loopback `profile-service.mjs` — CF Access JWT verify, git auto-commit of profile edits |

## Why the `.path` globs are literals

A `.path` unit **cannot read an environment variable** — no `%E`, no `EnvironmentFile`, no expansion. The
`PathExistsGlob=` prefixes in `prelim-driver.path` and `prelim-outbox.path` are therefore hardcoded
(`%h/.openclaw/…`), and they restate what `CLEAROTRON_WORK_DIR` and `CLEAROTRON_OUTBOX_DIR` say in the deployment's
`.env`, in a second place nothing at runtime compares. **When a workspace root moves, these lines move with it —
same box, same change.** Disagreement is silent: the runner drains one directory while the watcher arms an inotify
on another, no unit fails, nothing is logged, and only the timer still drains.

Nothing enforces that rule on a live box; two checks only report on it, and both have to be invoked.
`scripts/drain-preflight.mjs` (`npm run drain-preflight`, as the account the runner runs as) is one comparison over
two input pairs — `prelim-driver.path`'s globs against the runner's `config.queueDirs`, `prelim-outbox.path`'s glob
against `config.outboxDir` — reported as two verdicts, because an unwatched queue means jobs never run while an
unwatched outbox only drops delivery back to the 55-minute completion-watch.
`driver/test/data-plane-defaults.test.mjs` asserts both globs against the checked-in the production env example, never
against this box's `.env`.

## Generic units and template units

A `TEMPLATE UNIT` banner comment in the file is the discriminator — `isTemplateUnit` in `driver/unit-file-drift.mjs`
matches it out of the raw text, so the file classifies itself rather than a list beside it doing so, and anything
without the banner is generic. A **generic** unit (`prelim-driver.service`) defers its values to the
EnvironmentFile, so it is safe to sync verbatim and its live copy is expected to match. A **template** unit
(`profile-service.service`) ships `<your-…>` / `example.com` placeholders while the live copy holds the real values
your auth proxy needs — diff it, never overwrite it. A deploy syncs code, not units.

## Installing them

These are **user** units, and one step before them is the only thing on this page that needs root.

### 0. Enable lingering, or the lane dies when you log out

**A user manager is torn down when its user's last session ends, and every unit under it goes with
it.** Nothing warns you. The lane runs perfectly for as long as you stay logged in, and the next time
anyone looks the timer is gone and no job has been claimed since your session ended — which reads as a
product fault and is not one.

```sh
# Needs root (or a polkit prompt). Run it ONCE per user that owns these units.
sudo loginctl enable-linger "$(id -un)"

# Confirm it, rather than assuming. This must print Linger=yes.
loginctl show-user "$(id -un)" --property=Linger
```

`$(id -un)` rather than `$USER`: `$USER` is set by a login shell and is empty in plenty of the places
you might paste this — a script, a `sudo` environment, a non-interactive session. `loginctl` then
reports `Failed to look up user :` and exits **0**, so a check written that way passes while having
looked at nothing.

**Do not reach for `nohup` instead.** It keeps a process alive and gives up everything the unit was for
— the restart, the ordering, the log, the ability to stop it by name — and it leaves orphans behind that
someone has to find and kill by hand.

Everything below this step runs as your own user and needs no root.

```sh
# 1. Tell the units where this checkout is. They cannot work it out: systemd does not expand
#    variables in WorkingDirectory=, and the directory is named after whatever repository you cloned.
echo "CLEAROTRON_CHECKOUT_DIR=$PWD" >> ~/.env

# 2. Install the unit files.
mkdir -p ~/.config/systemd/user
node driver/systemd/render-units.mjs --apply     # the three units below; see "Resolved units"
cp driver/systemd/prelim-driver.service driver/systemd/prelim-driver.timer ~/.config/systemd/user/
systemctl --user daemon-reload

# 3. Start the lane. The TIMER is the one to enable on a fresh install -- see below.
systemctl --user enable --now prelim-driver.timer

# 4. Confirm it is actually armed, rather than assuming.
systemctl --user status prelim-driver.timer

# 5. And confirm it survives you leaving. Log out, log back in, and ask again:
#    a timer that is gone here is step 0 undone, not a unit that failed.
systemctl --user status prelim-driver.timer
```

### The timer is the working minimum. The `.path` unit is an optional extra, and it can watch nothing.

`prelim-driver.timer` triggers `prelim-driver.service` every 90 seconds and **depends on no path at
all**. That is a complete drain lane with nothing to configure, and it is what a fresh install should
enable.

`prelim-driver.path` exists to cut the latency from "within 90s" to "immediately". It arms an inotify
on a **literal glob** -- a `.path` unit cannot read an environment variable, so the glob cannot follow
your configuration:

```
PathExistsGlob=%h/.openclaw/workspace-clawdi/studio/prelim-search/queue/*.json
```

**That prefix is one deployment's layout, not yours.** Enable this unit without editing that line to
match your own queue directory and it watches a path nothing writes to: jobs land, the watcher never
fires, **no unit fails and no log line appears**. The unit's own header states the same thing. If you
want it, edit the glob first and confirm it matches the directory the runner actually drains; if you
do not, the timer has already covered you.

`~/.env` is the file the units load with `EnvironmentFile=%h/.env`, and it sits **outside** the
checkout deliberately — a file inside the checkout must not configure a service ([INSTALL.md
§3](../../INSTALL.md)). The units also set `CLEAROTRON_NO_ENV_FILE=1` so a stray `.env` left in the
checkout by a debugging session cannot quietly reconfigure the queue drain.

**If the service fails to start**, `systemctl --user status prelim-driver.service` names the reason.
The two that have actually happened: `CLEAROTRON_CHECKOUT_DIR` unset — so `ExecStart` resolves to
`/driver/runner.mjs`, which does not exist — and `claude` not on the unit's `PATH`, which is not a
start failure at all but shows later as every stage burning its retry ladder for zero tokens. For the
second, set `CLEAROTRON_CLAUDE_PATH` in `~/.env` to the binary's absolute path; the unit's `PATH`
already covers `~/.local/bin` and `~/.npm-global/bin`, the two layouts the documents permit.

### `profile-service.service` needs its checkout path edited by hand

The other units in this directory resolve the checkout from `CLEAROTRON_CHECKOUT_DIR` in
`EnvironmentFile=%h/.env`. **`profile-service.service` cannot**, and the reason is in the unit itself:

> NO `EnvironmentFile=~/.env`: this service reads NO production secret … the three CF Access
> identifiers below are NON-SECRET and set EXPLICITLY so the trademark AUD can't be shadowed by the
> tm-mcp app's `CLEAROTRON_OIDC_AUDIENCE` in `~/.env`. Least-privilege by design.

On systemd an `EnvironmentFile` **wins over** an `Environment=` line in the same unit — a precedence
fact recorded in `mcp-server/remote/client-mcp.service` after it cost a restart to find. So giving this
unit an environment file to gain one variable would let `~/.env` override those explicit identifiers and
reintroduce exactly the shadowing the unit exists to prevent.

**So edit these two lines to your own checkout before enabling it:**

```ini
WorkingDirectory=%h/<your-checkout>/driver
ExecStart=/usr/bin/node %h/<your-checkout>/driver/profile-service.mjs
```

The shipped value names the repository this one was cut from, so it is wrong on every documented
install rather than merely wrong on some.

## What a host must have, and what happens without it

These two are why a hosted deployment wants Linux. Neither is reached by `npx clearotron demo`, by a run
you start by hand, or by the MCP server — a clearance runs end to end on macOS. The second row is not a
platform limit: it names a capability macOS and Linux both have, listed because a box with neither
degrades and the degradation should be findable.

| Part | Needs | What happens without it |
|---|---|---|
| **Outbox delivery trigger** — `driver/deliver-trigger.sh`, driven by the `prelim-outbox` systemd `.path`/`.service`/`.timer` units | systemd; bash >= 4 for `declare -A`; `timeout(1)` (GNU coreutils, or `gtimeout` from Homebrew) as the enforced wall on every courier wake | The script refuses at startup and names the missing piece. It will not wake a courier it cannot put a wall around — an unkillable wake wedged a lane for 19h once. No event is touched: everything stays pending and delivers as soon as the host is fixed. |
| **PID-reuse claim defence** — the queue runner telling a live claimer from a recycled pid | A birth stamp for a process:`/proc/<pid>/stat` on Linux, `ps -o lstart` on macOS and anywhere else POSIX. Absent only where neither answers — WSL1, some sandboxes | Degrades **fail-safe**, and the runner says so once at startup. Claims record a bare pid, so a claim whose liveness cannot be proved counts as alive: no run is ever double-claimed and no lawyer double-delivered to. What is lost is the escape hatch — a `.processing` marker held by a recycled pid waits for the max-claim-age ceiling instead of being freed on the next tick. |

CI runs the suite on macOS as well as Linux, and an assertion covering a capability the box lacks skips
there **by name**, printing which one was missing. A skip whose reason is not in the table above is a gap
in the table. The birth-stamp row stopped producing one on macOS when the
defence gained its second implementation — the capability is probed by calling the reader, so the arms
now run there rather than skipping.

## Where to start

`prelim-driver.path` — its header carries the constraint above in full, including why the globs track the root this
deployment pins rather than the code default. Then `prelim-driver.service`, the big spender, because it runs
`runner.mjs`. It is not the only unit that spends: `prelim-outbox.service` wakes one agent turn per distinct agent
named across the pending markers, on the cheap cataloged model (`CLEAROTRON_OUTBOX_WAKE_MODEL`, default
`anthropic/claude-haiku-4-5`) under an 840s wall — small per wake, and markers nothing ever consumed once burned
$380 before the no-progress quarantine in `outbox-backoff.mjs`. Every unit but `profile-service.service` names
[`../README.md`](../README.md) in `Documentation=`.

This directory is not every unit the repo ships: `mcp-server/remote/` and `providers/oauth-mcp-bridge/systemd/` hold
four more. `driver/unit-inventory.mjs` is the list of which units a deployment is supposed to have, each either
tracked or named with the reason it is not.
