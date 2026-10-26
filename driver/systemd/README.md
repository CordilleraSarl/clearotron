# systemd units for a hosted deployment

The reference systemd **user** units for a server that runs the product unattended: the worker that drains the job
queue and runs each clearance, the portal, the MCP face the portal calls, the client MCP door, and an optional hourly
deploy. Every repo and data path is `%h`-relative. Every unit takes what differs per box from `EnvironmentFile=%h/.env`
and expands `${CLEAROTRON_CHECKOUT_DIR}` in `ExecStart=`, and every unit sets `CLEAROTRON_NO_ENV_FILE=1`, so a stray
`.env` left in the checkout by a debugging session cannot quietly reconfigure a running service.

| File | What it does |
|---|---|
| `clearotron-worker.service` | `Type=simple`: runs `driver/runner.mjs --watch`, which drains the job queue and resumes parked runs whose window has passed. The one unit that spends: it runs every clearance |
| `clearotron-portal.service` | runs `driver/portal-service.mjs`: the UI, the API, the sign-in and the configuration surface |
| `clearotron-mcp-face.service` | runs `mcp-server/http-server.mjs`: the engine door the portal calls over MCP |
| `clearotron-client-mcp.service` | runs `mcp-server/http-server-client.mjs`: the door for a company's signed-in people and their access keys |
| `clearotron-deploy.service` | `Type=oneshot`: runs `clearotron update`, which fast-forwards this checkout to `origin/main`. It refuses while a run is queued or in flight and exits 4, which the unit counts as success, so a busy box simply skips that firing |
| `clearotron-deploy.timer` | fires the deploy unit five minutes after boot and every hour after it. Optional: nothing else depends on it |
| `render-units.mjs` | writes a unit's installed copy, resolving any `@NAME@` placeholder a unit carries; it refuses rather than writing a partial unit |
| `install-census.mjs` | derives, from the units themselves, what each one refuses to start without |

The four services are the set `clearotron start --background` installs (`shared/server-units.mjs`). Each long-running
one restarts on failure ten seconds later.

These are for a **server, not a laptop**. On a workstation `clearotron start` runs the same product in the foreground,
and `clearotron start --background` installs these four units as your own user services ([`INSTALL.md`
§6](../../INSTALL.md)). `node driver/runner.mjs --watch` is what to run by hand if you started with `--no-worker`
(`INSTALL.md` §5): one foreground process that polls for queued jobs and for parked runs whose window has elapsed.

The packaged install runs no outbox watcher. An assistant that couriers delivered reports wakes itself
([`../../docs/DELIVERY.md`](../../docs/DELIVERY.md)); `driver/deliver-trigger.sh` is one agent platform's reference
wake, not a unit this directory ships.

## Installing them

These are **user** units, and one step before them is the only thing on this page that needs root.

### 0. Enable lingering, or the services die when you log out

**A user manager is torn down when its user's last session ends, and every unit under it goes with
it.** Nothing warns you. The worker runs perfectly for as long as you stay logged in, and the next time
anyone looks it is gone and no job has been claimed since your session ended — which reads as a
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

### 1. The four services

```sh
clearotron start --background     # writes ~/.env, installs the four units, enables and starts them
clearotron status                 # is each one up, and on which ports
```

`start --background` writes everything the services need into `~/.env`, including `CLEAROTRON_CHECKOUT_DIR`, and
renders each unit through `render-units.mjs` into `~/.config/systemd/user/` rather than copying it raw. `clearotron
stop` removes the four unit files again. `~/.env` sits **outside** the checkout deliberately — a file inside the
checkout must not configure a service ([`INSTALL.md` §3](../../INSTALL.md)).

### 2. The deploy timer, if you want this install kept current

```sh
cp driver/systemd/clearotron-deploy.{service,timer} ~/.config/systemd/user/
systemctl --user daemon-reload && systemctl --user enable --now clearotron-deploy.timer
```

Both are generic: the checkout path comes from `~/.env`, and neither starts nor stops the worker.

### And confirm it survives you leaving

Log out, log back in, and run `clearotron status` again. A service that is gone here is step 0 undone, not a unit
that failed.

**If the worker fails to start**, `systemctl --user status clearotron-worker.service` names the reason.
The two that have actually happened: `CLEAROTRON_CHECKOUT_DIR` unset — so `ExecStart` resolves to
`/driver/runner.mjs`, which does not exist — and no `claude` the unit can find, which is not a start
failure at all but shows later as every stage burning its retry ladder for zero tokens. `clearotron
install` offers to install the chosen engine's program into `~/.local/share/clearotron/engines`, and the
unit uses that copy when its `PATH` has none, so the second happens only when that offer was declined.
Accept it by running `clearotron install` again, or set `CLEAROTRON_CLAUDE_PATH`
in `~/.env` to the binary's absolute path; the unit's `PATH` already covers `~/.local/bin` and
`~/.npm-global/bin`, the two layouts the documents permit.

## What a host must have, and what happens without it

The units need systemd, so a hosted deployment wants Linux. Nothing else here does: `npx clearotron demo`, a run you
start by hand and the MCP server all run a clearance end to end on macOS. The row below is not a platform limit: it
names a capability macOS and Linux both have, listed because a box with neither degrades and the degradation should be
findable.

| Part | Needs | What happens without it |
|---|---|---|
| **PID-reuse claim defence** — the queue runner telling a live claimer from a recycled pid | A birth stamp for a process:`/proc/<pid>/stat` on Linux, `ps -o lstart` on macOS and anywhere else POSIX. Absent only where neither answers — WSL1, some sandboxes | Degrades **fail-safe**, and the runner says so once at startup. Claims record a bare pid, so a claim whose liveness cannot be proved counts as alive: no run is ever double-claimed and no lawyer double-delivered to. What is lost is the escape hatch — a `.processing` marker held by a recycled pid waits for the max-claim-age ceiling instead of being freed on the next tick. |

CI runs the suite on Linux. On macOS it installs the package and runs `clearotron doctor` and the demo,
and runs no suite, so a row above that differs on macOS has no CI run behind it there. An assertion
covering a capability a machine lacks skips **by name**, printing which one was missing; a skip whose
reason is not in the table above is a gap in the table.

## Where to start

`clearotron-worker.service` — it runs `runner.mjs`, the unit that spends. Then `clearotron-portal.service`, the one
people sign in to. Every unit names a document in `Documentation=`.

This directory is not every unit the repo ships: `mcp-server/remote/` and `providers/oauth-mcp-bridge/systemd/` hold
more. `driver/unit-inventory.mjs` is the list of which units a deployment is supposed to have, each either tracked or
named with the reason it is not.
