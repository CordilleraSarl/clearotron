#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// clearotron start — THE command that starts this product on one machine.
//
//   npx clearotron start                  start the portal and the trigger lane; print one URL
//   npx clearotron start --user you@host  the one address that signs in (persisted; asked for once)
//   npx clearotron start --base <dir>     where this install keeps its data (default ~/trademark)
//   npx clearotron start --port <n>       the portal's port (default 18802)
//   npx clearotron start --demo           the demo posture: own data directory, nothing persisted
//   npx clearotron start --no-worker      do not drain the queue here; run the worker yourself
//   npx clearotron start --help
//
// It is NOT `npm run example`. Demo replays a frozen example report with no credentials, no model and no
// engine — the fastest way to see what this product produces. This starts the real thing: a portal you
// sign in to, with a working Start button behind it.
//
// ── ONE PROCESS OR SEVERAL? SEVERAL, AND THIS IS THE LIST ────────────────────────────────────────────
//
// This file is a SUPERVISOR. It starts two child processes and nothing else:
//
//   driver/portal-service.mjs     the product: the UI, the API, the sign-in, the config surface.
//   mcp-server/http-server.mjs    the engine door the portal's Start button calls over real MCP.
//
// FOUR services and one process were the alternative, and the reason it is two is not taste. The portal
// ALREADY constructs profile-service and recipe-service in-process (portal-service.mjs — "profile-service
// is constructed IN-PROCESS rather than called over HTTP"), running the same routers, the same
// validators and the same git-commit path with the portal's own verified identity as the author. So two
// of the four services cost zero processes here and are simply never started as servers.
//
// The MCP face cannot collapse the same way, and should not. The trigger lane is a REAL hop with a
// verb-scoped, account-capped ops key on it, and that key is the only thing bounding what the portal may
// start. Folding the face into the portal would delete the wall while leaving the diagram. It also
// stays a separate process for the reason the hosted deployment keeps it one: it pulls the MCP
// Streamable-HTTP transport (undici) that nothing else in the portal needs.
//
// A CRASH IS REPORTED, NEVER ABSORBED. If either child exits while this command is running, that is
// named on stderr — which one, and with what code — and everything else is stopped. A supervisor that
// let one child die and left the other serving would turn a dead trigger lane into a red panel in the
// browser, which is the shape of failure this whole command exists to remove.
//
// ── NO `*_AUTH_DISABLED`, ANYWHERE, AND NOT BY LUCK ──────────────────────────────────────────────────
//
// Both doors this command opens PROVE who the caller is:
//
//   the portal   PORTAL_AUTH_MODE=local  — one address, one passphrase, a signed session cookie.
//   the face     TRADEMARK_MCP_AUTH_MODE=token — a mandatory HMAC-signed ops key, no proxy, no synthetic
//                identity. Its handler refuses outright to be built with a bypass alongside it.
//
// `TRADEMARK_MCP_AUTH_DISABLED` and `TRADEMARK_MCP_DEV` are written into the face's environment as `0`,
// so this command cannot pick one up from a stray `.env` and cannot be read as depending on one.
//
// `PROFILE_AUTH_DISABLED` and `RECIPE_AUTH_DISABLED` are untouched and unreachable: they live in each
// file's standalone `isMain` bootstrap, this command never runs those bootstraps, and an imported module
// has no bootstrap. Deleting them belongs to whoever retires the standalone editors, not here.
//
// ── PORTS AGREE BY CONSTRUCTION ──────────────────────────────────────────────────────────────────────
//
// One `ports` object is resolved once and is the ONLY source of a port number in this file. The face's
// listener, its allowed-Host list and the portal's `PORTAL_MCP_URL` are all derived from `ports.mcp` in
// `childEnv()` below — one expression each, no literal repeated. Two places sharing a default is the
// defect this replaces: `PORTAL_MCP_URL=…:18790` sits in the portal's systemd unit while the code
// comment beside it uses 18791, and nothing has ever compared them.
//
// ── SECOND RUN ASKS NOTHING ──────────────────────────────────────────────────────────────────────────
//
// The two generated secrets and the chosen address are written ONCE into `<repo>/.env`, ADD-ONLY: an
// existing line is never rewritten, reordered or removed, because that file also holds the credentials
// `npm run setup` collected. A second run finds them, re-reads them through shared/env-local.mjs and
// starts silently. The sign-in passphrase is not ours — portal-service mints and prints it once on its
// own first run and stores a scrypt digest; later runs read the digest and print nothing.
//
// The ops key is deliberately NOT persisted. It is minted fresh, in memory, at every start, so no
// long-lived engine credential is written to disk by a command whose job is to show you the product.

import "../shared/env-local.mjs";   // side effect: apply <repo>/.env when THIS file is the CLI entry (never on library import)
// — ONE AUTHORITY for what a clearance needs from its environment, used twice
// below: to COMPOSE the units' environment and to GUARD it before this command reports success. The
// tables are handed in rather than imported by it, because the register table lives in a CLI entry and
// the driver must not point at `bin/`.
import { runRequiredNames, missingRequirements } from "../driver/run-requirements.mjs";
import { ENGINE_BINARIES, DEFAULT_ENGINE_ID as RUN_DEFAULT_ENGINE } from "../driver/driver.config.mjs";

/**
 * The tables the requirements authority needs — resolved at CALL time, never at module scope.
 *
 * ── THE REGISTER TABLE IS IMPORTED DYNAMICALLY, AND THAT IS LOAD-BEARING ──────────────────────────
 *
 * The operator-facing register list (which register offers what, and which credential each needs) lives
 * in `bin/onboard.mjs`, and `bin/onboard.mjs` already reaches BACK into this file for BACKGROUND_UNITS.
 * A STATIC import here closes that loop, and the failure is not a warning: onboard's top-level
 * `await runCli()` never settles, and `clearotron doctor` exits 13 having printed most of a report.
 * Measured — I wrote the static import, and the suite caught it on the first honest run.
 *
 * A dynamic import inside a function has no load-time cycle to close, so both directions stay legal.
 * The right structural fix is for that table to live somewhere neither entry point owns; it is a
 * sixty-line move through the wizard and does not belong in a pre-cut batch. An arm pins the shape:
 * driver/test/a-backgrounded-install-can-actually-run-a-clearance.test.mjs refuses a static import of
 * onboard from this file, so the cycle cannot come back quietly.
 */
async function runTables() {
  const { PROVIDERS } = await import("./onboard.mjs");
  return { registers: PROVIDERS, engines: ENGINE_BINARIES, defaultEngine: RUN_DEFAULT_ENGINE };
}
import { spawn, execFileSync } from "node:child_process";
import { storeInRepo, storeOutsideRepoMessage } from "../shared/store-in-repo.mjs";   //
import { stdioConnectOffer } from "../shared/stdio-connect.mjs";
import { mergeEnvFile } from "../shared/env-file-merge.mjs";
import { mcpOriginFor } from "../shared/lane-address.mjs";   // — one author for the origin
import { SERVER_INSTALL_SET, unitsToRestartOnRefresh, unitHealthVerdict } from "../shared/server-units.mjs";   // — one authority, two callers
// — the door --background now INSTALLS, and the one authority for the settings
// it refuses to start without. (Until 2026-09-03 this import read "the one unit --background may
// tolerate and never manage"; settled point 2 superseded that.)
import { defaultDenylistPath, denylistPathFor, ensureDenylistFile, CLIENT_DOOR_UNIT, enablePlan, clientDoorPort } from "../shared/client-door.mjs";
import { createServer } from "node:net";
import { listenErrorMessage } from "../shared/listen.mjs";
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { invocationPrefix, invoke } from "../shared/invocation.mjs";   // — the banner names the verb
import { homedir, userInfo } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { usageBlock } from "../shared/usage-block.mjs";   // tracker issues 1861/1882
import { isEntrypoint } from "../shared/is-entrypoint.mjs";   // — one entry-point test, all spellings
import { productIdentity } from "../shared/product-identity.mjs";   // AGPL §13 — one answer, three surfaces
import { pinEnvAll } from "../shared/env-aliases.mjs";   // — a pin that names one spelling has set nothing that wins
import { BRAND } from "../shared/brand.mjs";   // — the installer's own name, from the tenant seam

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const ENV_PATH = join(REPO, ".env");
/** Where `render-units.mjs --apply` installs, and therefore where "this box is a server" is visible. */
export const UNIT_DIR = join(homedir(), ".config", "systemd", "user");
/** The shipped units that make this box a server. A door unit alone is enough; so is the drain. */
export const SERVER_UNITS = Object.freeze([
  "clearotron-portal.service", "clearotron-mcp-face.service", "prelim-driver.service",
]);
/**
 * Which of the shipped units are installed on this box.
 *
 * FILE PRESENCE, NOT `systemctl`. A unit that is installed but stopped still means this box is a server
 * whose configuration lives in its EnvironmentFile — and asking systemd would make this command's answer
 * depend on whether a service happened to be running, which is the kind of moving answer that produced
 * the defect above. It is also one fewer subprocess in a command that is about to spawn two.
 */
export function installedUnits(dir = UNIT_DIR, exists = existsSync) {
  return SERVER_UNITS.filter((u) => exists(join(dir, u)));
}

// Loopback, and not configurable. Both doors carry a secret that a browser or the portal sends in
// clear — a passphrase in a form POST, an ops key in a header — and neither service will bind anything
// else in these modes anyway. Reaching this install from another machine is a TLS-terminating proxy in
// front of it, which is a deployment, and the deployment already has its own doors.
const HOST = "127.0.0.1";

// ── pure helpers (exported for driver/test/start-command.test.mjs) ───────────────────────────────────

/** The two ports, from the environment or the shipped defaults. Throws on a value that is not a port. */
export function resolvePorts(env = {}) {
  const one = (name, dflt) => {
    const raw = String(env[name] ?? "").trim();
    if (!raw) return dflt;
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 1 || n > 65535) throw new Error(`${name}="${raw}" is not a port number (1–65535).`);
    return n;
  };
  // F26 — the client door is started on BOTH paths now, so its port is resolved
  // here with the other two rather than only where the units are written. 18811 is the door's own
  // default and shared/client-door.mjs states it; the literal is not repeated, it is imported.
  return { portal: one("PORTAL_SERVICE_PORT", 18802), mcp: one("TRADEMARK_MCP_HTTP_PORT", 18790),
    client: one("CLIENT_MCP_HTTP_PORT", clientDoorPort({})) };
}

/**
 * Where the grants file is, for a command that is NOT the supervisor.
 *
 * — bb8's F13. `start` injects CLEAROTRON_ACCESS_FILE into the environment of
 * the services it supervises (see the child env below) and never persists it, so the door finds the
 * roster and every sibling CLI in the operator's own shell does not. `clearotron grant` then refused
 * with "Set CLEAROTRON_ACCESS_FILE" — a variable nothing writes — and enrolling a client had no working
 * path at all.
 *
 * Resolved HERE, beside installPaths, because the shape is installPaths' business: a default computed
 * in grant.mjs would be a second opinion about the same path, and the two would drift the first time
 * anyone moved the base.
 *
 * The order is: the variable if an operator set one; then the base implied by CLEAROTRON_REPORTS_DIR,
 * which is what setup records when `--base` moved the install; then the documented default.
 */
export function defaultGrantsPath({ env = process.env, demo = false } = {}) {
  const explicit = String(env.CLEAROTRON_ACCESS_FILE ?? "").trim();
  if (explicit) return explicit;
  const pool = String(env.CLEAROTRON_REPORTS_DIR ?? "").trim();
  // The pool sits at <base>/pool, so its parent is the base — the same relationship installPaths states.
  if (pool) return installPaths(dirname(pool)).grants;
  return installPaths(join(homedir(), demo ? "trademark-demo" : "trademark")).grants;
}

/** Everything this install keeps on disk, under one base directory. */
export function installPaths(base) {
  return {
    base,
    pool: join(base, "pool"),
    workspace: join(base, "workspace"),
    queue: join(base, "queue"),
    outbox: join(base, "outbox"),
    locks: join(base, "locks"),
    grants: join(base, "grants.json"),
    audit: join(base, "portal-audit.log"),
    // The saved-search store is a git repository because recipe-service commits every save through
    // `git add` + `git commit` — that is the product's config-store model, not something invented here.
    // It is its own directory, NOT `base`, so the commit path never sees the pool, the queue or the
    // workspace as untracked noise.
    // — named here so the demo's isolation is a property of the layout rather
    // than a string built at one call site. A live install leaves it unset and keeps the shared default.
    credential: join(base, "portal-local-credential.json"),
    configStore: join(base, "config"),
    recipes: join(base, "config", "recipes"),
  };
}

/**
 * The one address that signs in, and the staff domain derived from it.
 *
 * Derived, never asked twice. In local mode the portal admits EXACTLY ONE address, so a domain-wide
 * staff rule built from that address admits exactly that address and nobody else — which is what makes
 * it safe here and would not be safe on a hosted instance. Without it the sign-in succeeds and every
 * page 403s, because signing in is not being enrolled (portal-access.mjs decides that, and it is
 * deliberately blind to which door you came through).
 */
export function staffDomainFor(email) {
  const at = String(email ?? "").lastIndexOf("@");
  return at > 0 ? String(email).slice(at + 1).toLowerCase() : "";
}

/**
 * The environment each child is started with — and the ONLY place a port becomes a string or a URL.
 *
 * `PORTAL_MCP_URL` is an ORIGIN. The portal's MCP client appends `/mcp` itself, so a value carrying it
 * produces `/mcp/mcp` and 404s on the first press; that is test-pinned in portal-mcp-client.test.mjs
 * and it is the reason this is built here from `ports.mcp` rather than written out anywhere.
 */
// ── THE BACKGROUND SET — PINNED, because enabling a unit is a decision ─────
//
// `--background` enables exactly these. Pinned rather than derived: a derived enable-list fails OPEN —
// a new shipped unit would come up on every laptop the day it lands, nobody having decided that. The
// census arm (driver/test/start-background-units.test.mjs) forces the decision: every shipped unit is
// in this pin or in the exclusion table with its reason. (Until 2026-09-03 this sentence ended "and
// the client door can NEVER be pinned" — settled point 2 superseded that, and the
// door is now pinned like every other unit a server runs.)
// ONE AUTHORITY, TWO CALLERS. This list used to live here as a literal, and the
// hosted install path answered the same question separately — which is how a documented install came to
// place two units, both of them the wrong ones. It moved to shared/server-units.mjs so that neither
// caller owns it; the re-export keeps this name working for everything that already reads it.
const BACKGROUND_UNITS = SERVER_INSTALL_SET;
export { BACKGROUND_UNITS };

/** A unit's declared systemd Type, lowercased — one reader, so the restart decision and the health
 *  check below cannot drift. An unreadable unit file reads as `simple`, the stricter judgement: a
 *  long-running service is restarted and health-checked, and being wrong that way costs a restart
 *  rather than a missed fault. */
const unitTypeOf = (u) => {
  try {
    return (readFileSync(join(REPO, "driver", "systemd", u), "utf8").match(/^Type=(\w+)/m)?.[1] ?? "simple").toLowerCase();
  } catch { return "simple"; }
};
// ── UNITS THIS FLAG ONCE INSTALLED AND NOW RETIRES ─────────────────────────────
//
// A box that ran `--background` before the retirement HAS these three installed and enabled. They must
// stay MANAGED, or the carve below reads them as foreign, concludes the box is a real server, and the
// flag refuses on exactly the boxes it previously worked on — "making the flag unrunnable exactly once
// it has worked", which is the failure its own comment records being found by driving it twice.
//
// AND THEY MUST BE DISARMED, not merely unpinned. The worker drains continuously; leaving the timer
// armed puts a second claimant on the queue. The claim itself is atomic — `runner.mjs:714` renames
// `<id>.json` to the lock path and only one racer wins — so this is not double-execution. What it does
// cost is the admission cap: counts are serial per queue while queues drain concurrently, so two
// claimers can overshoot a per-account cap by a bounded one per queue. A bounded overshoot is not a
// reason to leave a retired unit running when disarming it is one call.
export const BACKGROUND_RETIRED = Object.freeze([
  "prelim-driver.service", "prelim-driver.timer", "prelim-driver.path",
]);

export const BACKGROUND_EXCLUDED = Object.freeze({
  // ── `clearotron-client-mcp.service` LEFT THIS TABLE ON 2026-09-03, AND SAYING SO IS THE POINT ────
  //
  // It was the rebuild-seam gate of record (owner rulings, tracker issues 1976/2082): starting the unit
  // WAS the on-demand consent, because starting it turned on client-account access, so an enable list
  // that included it would have made that consent meaningless. That reasoning was right under that
  // ruling and the exclusion was not an oversight.
  //
  // The owner superseded it knowingly (, settled point 2): the door auto-starts with
  // the product and the per-account key is the gate. It is now in SERVER_INSTALL_SET — which IS
  // BACKGROUND_UNITS — and the pin/exclusion partition means it cannot be in both, so the row is gone
  // rather than reworded. `--background` writes its settings from `enablePlan` before installing it.
  "clearotron-deploy.service": "self-update is a SERVER posture — a laptop updates when its owner runs `clearotron update`, not on an hourly pull it never asked for",
  "clearotron-deploy.timer": "the self-update pull's timer — excluded with its service",
  // RETIRED, NOT MERELY UNPINNED. These three were pinned above until the ruling
  // retired the posture; their files stay in the tree only until production is rebuilt off this codebase,
  // because production runs them today and deleting them would remove the only tracked description of a
  // live service. An exclusion reason is required to be a sentence, and the true sentence is that the
  // unit is going — not that a workstation should not start it.
  "prelim-driver.service": "RETIRED with the path-watcher/timer drain posture (owner ruling 2026-08-26, restated 2026-08-31) — clearotron-worker.service is the drain, and this file survives only until production's rebuild",
  "prelim-driver.timer": "RETIRED with prelim-driver.service — the 90s pull the worker's --watch replaces",
  "prelim-driver.path": "RETIRED with prelim-driver.service — the queue watcher whose glob a documented install never writes",
  "prelim-outbox.service": "the delivery outbox drains toward real clients — a production lane, not something a workstation should start by default",
  "prelim-outbox.path": "the outbox watcher — excluded with its service",
  "prelim-outbox.timer": "the outbox sweep — excluded with its service",
  "profile-service.service": "the portal constructs the profile service IN-PROCESS (driver/portal-service.mjs); the standalone unit is the separate-editor deployment shape and running both double-serves the store",
});

export function childEnv({ ports, paths, user, staffDomains, portalSecret, tokenSecret, opsToken, host = HOST, localWorker = false, demo = false, clientFence = null, env = process.env }) {
  // ONE AUTHOR FOR THIS EXPRESSION. The hosted install path composes the same
  // origin, and the near-miss is specific: this is an ORIGIN, the portal's client appends `/mcp`
  // itself, and a second author writing the endpoint form produces a doubled path — a 404 at submit
  // time with nothing wrong anywhere else.
  const mcpOrigin = mcpOriginFor({ host, port: ports.mcp });
  // EVERY SPELLING, or the sentence below is not true. Each of these names answers to two
  // spellings, and a child that translates resolves the CURRENT one first: an operator whose shell
  // carries `CLEAROTRON_WORK_DIR` gets THEIR directory, not the one this supervisor just computed, and
  // the run says so in one line nobody reads.
  //
  // MEASURED, not reasoned about. Handing a child `CLEAROTRON_WORK_DIR=/install/trademark/workspace`
  // with `CLEAROTRON_WORK_DIR=/the/operators/own/dir` inherited, and running the child's own
  // `applyEnvAliases` over it, leaves `CLEAROTRON_WORK_DIR=/the/operators/own/dir`. `pinEnvAll`
  // writes both spellings, so there is nothing left to disagree with.
  const shared = pinEnvAll({
    // Exactly one process in this tree reads <repo>/.env: this one. The children are configured by what
    // is handed to them here, so a value the supervisor never saw cannot reach a child and disagree with
    // the supervisor's picture of the install. This is the switch shared/env-local.mjs names for "a
    // container, a supervisor".
    TRADEMARK_MCP_TOKEN_SECRET: tokenSecret,
  }, {
    // QUOTED KEYS, and that is not style. records the sweep's known limit: it finds a site by the
    // variable's LITERAL name beside the helper call, and a bare object key is invisible to it. The
    // behaviour is the same either way; what the quotes buy is that the guard can see this is handled.
    "CLEAROTRON_NO_ENV_FILE": "1",

    "CLEAROTRON_REPORTS_DIR": paths.pool,
    "CLEAROTRON_WORK_DIR": paths.workspace,
    "CLEAROTRON_QUEUE_DIR": paths.queue,
    "CLEAROTRON_OUTBOX_DIR": paths.outbox,
    "CLEAROTRON_RUN_LOCK_DIR": paths.locks,
    "CLEAROTRON_ACCESS_FILE": paths.grants,
  });
  return {
    url: `http://${host}:${ports.portal}/portal`,
    mcp: {
      ...shared,
      // — THIS DOOR LEARNS IT IS A DEMO, and only because it has a message to
      // re-aim: its boot warning about the customer roster is written for an operator of a real
      // deployment, and a demo visitor is neither. One name, shared with the portal, never read from a
      // file — these processes run with CLEAROTRON_NO_ENV_FILE=1.
      //
      // NOT IN `shared`. The worker would inherit it there and has no use for it: it drains a queue, and
      // a demo never puts anything in one. A fact handed to a process that does not need it is one
      // somebody branches on later.
      ...(demo ? { CLEAROTRON_DEMO: "1" } : {}),
      TRADEMARK_MCP_AUTH_MODE: "token",
      // Named `0`, not merely left unset. This command must be unable to inherit a bypass from a `.env`
      // written for something else, and must be unable to be read as depending on one.
      TRADEMARK_MCP_AUTH_DISABLED: "0",
      TRADEMARK_MCP_DEV: "0",
      TRADEMARK_MCP_HTTP_HOST: host,
      TRADEMARK_MCP_HTTP_PORT: String(ports.mcp),
      // DNS-rebinding protection is keyed off this list being non-empty, so it is derived from the same
      // port the listener is given rather than left to whoever remembers.
      TRADEMARK_MCP_ALLOWED_HOSTS: `${host}:${ports.mcp},localhost:${ports.mcp}`,
    },
    // The worker needs the install's PATHS and nothing else — no ports, no secrets, no door config. It
    // talks to the queue and the pool, not to either listener.
    worker: { ...shared },
    // ── THE CLIENT DOOR, ON BOTH PATHS ( — F26) ──────────────────────────────
    //
    // Owner ruling, restated several times in session: START BOTH. It already held on the systemd path
    // — the door is in SERVER_INSTALL_SET on the 2148 ruling that the door auto-starts and the
    // PER-ACCOUNT KEY is the gate — and it did not hold on the foreground path, with nothing saying
    // which of the two you were on. The owner spent the leg believing MCP had not started at all; it
    // had, and the door he was looking for was the other one.
    //
    // PARITY, NOT A NEW EXPOSURE. Every value here is what the units already get: the access file and
    // the token secret come from `shared` exactly as they do for the units, and the fence is the "1"
    // that `enablePlan` writes into the unit env file. A door reachable with no key issued refuses
    // everything, which is the protection the ruling relies on. An operator who has deliberately set
    // the fence to 0 keeps it — this composes a default, it does not overrule a decision.
    client: {
      ...shared,
      CLIENT_MCP_HTTP_HOST: host,
      CLIENT_MCP_HTTP_PORT: String(ports.client),
      // Derived from the same number the listener is given, for the reason the engine door's is: a port
      // written in one place and an allow-list in another drift into a door that starts and turns every
      // request away, which reads as a dead door rather than as a misconfiguration.
      CLIENT_MCP_ALLOWED_HOSTS: `${host}:${ports.client},localhost:${ports.client}`,
      CLIENT_MCP_ACCOUNT_ACCESS: String(clientFence ?? "1"),
      // TOKEN-ONLY, AND WITHOUT IT THE DOOR DOES NOT START. Found by driving it rather than by reading
      // the diff: with this unset the door demands an OIDC audience plus a Cloudflare Access team or
      // issuer and refuses fail-closed — correct for a hosted deployment behind an identity proxy, and
      // impossible on a local install, which has no proxy and never will. Token-only is the API-key
      // door: the key IS the identity, which is the gate the 2148 ruling relies on. shared/client-door
      // .mjs writes this into the unit env file for exactly this reason, so composing it here is the
      // parity, not an extra.
      CLIENT_MCP_TOKEN_ONLY: "1",
      // Born knowing where revocations land. A door started without this loads no denylist, and a jti
      // written by `disconnect` afterwards goes into a file the running door never reads — every check
      // looks done while the key stays live.
      // ONE FILE FOR BOTH DOORS. This composed the DEFAULT unconditionally —
      // `paths.denylist` is not a key `installPaths` returns, so the left side was always undefined —
      // while every other child inherited the operator's TRADEMARK_MCP_TOKEN_DENYLIST. An operator who
      // placed the list themselves therefore revoked at the staff door and not at the client door,
      // which is where account keys live, and `key issue` named the staff door's file to them.
      TRADEMARK_MCP_TOKEN_DENYLIST: paths.denylist ?? denylistPathFor(env, homedir()),
    },
    portal: {
      ...shared,
      PORTAL_AUTH_MODE: "local",
      PORTAL_LOCAL_USER: user,
      PORTAL_STAFF_DOMAINS: staffDomains,
      PORTAL_SECRET: portalSecret,
      PORTAL_SERVICE_HOST: host,
      PORTAL_SERVICE_PORT: String(ports.portal),
      PORTAL_AUDIT: paths.audit,
      PORTAL_MCP_URL: mcpOrigin,
      PORTAL_OPS_TOKEN: opsToken,
      // — the demo runs THIS portal, not a second one. What that difference IS
      // has changed: the products are orderable and the confirmation resolves to a report that already
      // exists (owner ruling 2026-08-31 14:47, superseding the greyed-control ruling of 14:44).
      //
      // The FLAG moved to `shared` and is `CLEAROTRON_DEMO`, because the
      // portal is no longer the only process that has to know: the MCP door prints a boot warning aimed
      // at an operator, and a demo visitor is not one. `PORTAL_DEMO` is retired rather than joined —
      // two names for one fact is how two subsystems come to disagree about it, and the old name was
      // already wrong for a process that is not the portal.
      ...(demo ? {
        CLEAROTRON_DEMO: "1",
        // AND THE SIGN-IN CREDENTIAL LIVES IN THE DEMO'S OWN BASE. Without this it defaults to
        // ~/.cordillera/portal-local-credential.json — shared with every install on the box — and the
        // demo then inherits a digest minted for somebody else's address: the portal prints "the
        // passphrase was minted on an earlier start and is NOT reprinted", and a visitor is handed a
        // sign-in screen they cannot pass. Measured by driving it. It is also
        // what makes "removing the demo is one directory" true rather than nearly true.
        PORTAL_LOCAL_CREDENTIAL: paths.credential,
      } : {}),
      // — ONLY set when this launcher is supervising a worker. It is what licenses the portal to say
      // "waiting for a worker": a deployed instance drains via systemd and writes no heartbeat, so without
      // this the portal must keep saying "waiting to start" rather than invent an alarm.
      ...(localWorker ? { PORTAL_LOCAL_WORKER: "1" } : {}),
      // Unset, saved searches are not "off" in any visible way — `/portal/api/config/searches` simply
      // answers 404 and a panel in the settings surface renders an error. A panel degraded to a string
      // is the failure this command exists to remove, so the store is named and created.
      CLEAROTRON_RECIPES_DIR: paths.recipes,
      RECIPE_REPO_ROOT: paths.configStore,
    },
  };
}

// MOVED to shared/env-file-merge.mjs: the documented hosted install now writes
// the engine-door origin too, and a driver module importing this CLI to borrow a pure text function is
// the wrong direction. Re-exported so every existing reader keeps working.
export { mergeEnvFile } from "../shared/env-file-merge.mjs";


// ── everything below runs only as a command ──────────────────────────────────────────────────────────

const isMain = isEntrypoint(import.meta.url);
if (isMain) {
  const argv = process.argv.slice(2);
  const say = (s = "") => process.stdout.write(`${s}\n`);
  const err = (s) => process.stderr.write(`${s}\n`);
  // Flipped at the first state-changing act ('s third criterion): a refusal AFTER
  // writes must say what survives and that re-running is safe — the reader's only question at that
  // moment, and one the screen never answered while the writes sat above the port probe.
  let wroteState = false;
  const markStateWritten = () => { wroteState = true; };
  const fatal = (msg) => {
    err(`\nstart: ${msg}\n`);
    if (wroteState) err("  This run had already written state (env file, data directories, grants, seeded example).\n  Every one of those writes is idempotent — re-running `clearotron start` is safe and nothing needs undoing.\n");
    process.exit(1);
  };

  // / AGPL §13 — THE CLI'S SOURCE OFFER. Ahead of --help on purpose: a licence question must be
  // answerable without reading anything else, and both flags exit.
  //
  // It prints the RUNNING COMMIT, not just a repository link. §13 obliges an operator running a modified
  // version to offer users the source of THAT version — a link to the default branch points at whatever
  // is there now, which on an install that has not pulled in a month is not the code in front of them.
  // A null commit is printed as unknown rather than papered over with a bare repo URL: a reader can then
  // tell "this is not a git checkout" from "here is the source you are running".
  if (argv.includes("--license") || argv.includes("--licence")) {
    const id = productIdentity();
    say(`${id.name} ${id.version ?? "(unknown version)"}`);
    say(`${id.copyright}`);
    say("");
    say(`Licence:  ${id.license ?? "(unknown — package.json could not be read)"}`);
    say(`Source:   ${id.sourceUrl}`);
    say(`Commit:   ${id.commit ?? "unknown — this install is not a git checkout, so the source link above is the repository, NOT the running build"}`);
    say("");
    say("This is free software under the GNU AGPL v3.0: you may use, study, change and share it.");
    say("It comes with NO WARRANTY, to the extent permitted by law. See LICENSE for the full text.");
    say("If you run a modified version as a network service, §13 obliges you to offer its users that");
    say("version's source — which is what this command, the portal's About page and the MCP server's");
    say("server_info tool each answer, with the commit above.");
    process.exit(0);
  }

  if (argv.includes("--help") || argv.includes("-h")) {
    // — was slice(1, 12), which began at the licence header.
    say(usageBlock(readFileSync(fileURLToPath(import.meta.url), "utf8")));
    process.exit(0);
  }

  // Declining the worker is a real posture, not a debug switch: someone who wants the old separation —
  // order here, drain deliberately over there — keeps it with this flag, and the closing block tells them
  // exactly how to drain when they do.
  const wantWorker = !argv.includes("--no-worker");
  const wantBackground = argv.includes("--background");

  // A flag with its value forgotten is a MISTAKE, not a request for the default. `--base` swallowing the
  // next flag, or falling through to ~/trademark, would put an install somewhere nobody asked for.
  const flag = (n, d = null) => {
    const i = argv.indexOf(n);
    if (i < 0) return d;
    const v = argv[i + 1];
    if (v === undefined || v.startsWith("--")) fatal(`${n} needs a value.`);
    return v;
  };

  // ── 1. what this install is ────────────────────────────────────────────────────────────────────────

  // A mode this command cannot honour is refused, never silently overridden. Someone whose environment
  // says auth-proxy (or its older spelling cf-access) has a hosted deployment in mind, and quietly
  // running a passphrase door instead would
  // be the same silent downgrade refused to build.
  // ── A BOX WITH THE SERVICES INSTALLED HAS ONE CONFIGURATION, AND IT IS NOT THIS ONE ───────────────
  //
  // Owner ruling,: "whatever is cleanest, simplest and industry-standard expected" —
  // and yes to refusing outright. A box carrying the shipped units is a SERVER: its configuration is the
  // units' `EnvironmentFile` (`%h/.env`), and this command's is `<repo>/.env`, the hand-run laptop file.
  //
  // The defect this replaces was subtler than a wrong answer. `start` read the HAND-RUN environment and
  // answered for the SERVICE — two different processes with deliberately disjoint configuration — so on
  // a correctly installed box, where those two files differ BY DESIGN, it found no hosted door in the
  // file it could see and started the passphrase door beside a service already serving another. It was
  // not reading one of two equally valid files; it was reading the wrong process's environment for the
  // question it was answering, and it would have kept being wrong on exactly the boxes that are set up
  // right.
  //
  // Reading the units' file instead would have made it correct and still wrong-shaped: two portals on
  // one box is not a configuration anybody wants, whichever file decided it.
  const installed = installedUnits();
  // ── THE ONE CARVE-OUT: --background re-run over its OWN units ──────────────
  //
  // Found by driving the flag twice: the first run installs the pinned units, and the second then
  // reads the box as a server and refuses — making the flag unrunnable exactly once it has worked.
  // The carve is narrow on purpose: every installed unit must be one this flag manages (or the client
  // door `clearotron connect` manages). A box carrying anything else — the deploy timer, the outbox
  // lane — is a real server, and the refusal below is still the right answer for it.
  const managed = new Set([...BACKGROUND_UNITS, ...BACKGROUND_RETIRED, CLIENT_DOOR_UNIT]);
  const foreign = installed.filter((u) => !managed.has(u));
  const backgroundRefresh = wantBackground && installed.length > 0 && foreign.length === 0;
  if (installed.length && !backgroundRefresh)
    fatal(`This box has the services installed — ${installed.join(", ")} in ${UNIT_DIR}.\n`
      + "  Its configuration is those units' EnvironmentFile, not this checkout's .env, and they are\n"
      + "  serving already. `clearotron start` is the LOCAL install: running it here would start a second\n"
      + "  portal beside the first, configured from a different file.\n\n"
      + "  Use the services:  systemctl --user status " + installed[0] + "\n"
      + "  Or, if this box should NOT be a server, disable and remove them first.");

  const declaredMode = (process.env.PORTAL_AUTH_MODE || "").trim().toLowerCase();
  if (declaredMode && declaredMode !== "local")
    fatal(`PORTAL_AUTH_MODE is set to "${declaredMode}" in this environment. \`npm start\` IS the local install and runs the local sign-in; the ${declaredMode} door belongs to the hosted deployment and its own units. Unset PORTAL_AUTH_MODE (or remove it from ${ENV_PATH}) to start here.`);

  let ports;
  try { ports = resolvePorts(process.env); } catch (e) { fatal(String(e.message)); }

  // The same base `npm run setup` writes under, so whichever of the two a reader ran first, the other
  // finds the same install rather than a second one beside it.
  const paths = installPaths(flag("--base", join(homedir(), argv.includes("--demo") ? "trademark-demo" : "trademark")));
  // Whatever the environment already says wins over the base-derived default, for every path — a reader
  // who ran `npm run setup` has these in .env already and this must not move their data.
  for (const [k, name] of [["pool", "CLEAROTRON_REPORTS_DIR"], ["workspace", "CLEAROTRON_WORK_DIR"], ["queue", "CLEAROTRON_QUEUE_DIR"],
    ["outbox", "CLEAROTRON_OUTBOX_DIR"], ["locks", "CLEAROTRON_RUN_LOCK_DIR"], ["grants", "CLEAROTRON_ACCESS_FILE"],
    ["recipes", "CLEAROTRON_RECIPES_DIR"]]) if (process.env[name]) paths[k] = process.env[name];
  if (process.env.RECIPE_REPO_ROOT) paths.configStore = process.env.RECIPE_REPO_ROOT;
  if (process.env.PORTAL_AUDIT) paths.audit = process.env.PORTAL_AUDIT;
  // recipe-service SAVES by committing, so the store has to live inside the repository it commits to.
  // Said at boot rather than discovered on the first Save, where the message is about `git add`.
  // — the shared statement, so the launcher, the two services and the portal cannot describe the
  // same misconfiguration four different ways. Also symlink-tolerant: the startsWith test here was purely
  // lexical, and an install reached through a symlinked path warned on a store that was genuinely inside.
  {
    const reach = storeInRepo(paths.recipes, paths.configStore);
    if (!reach.ok)
      err(`  WARNING: ${storeOutsideRepoMessage({ storeVar: "CLEAROTRON_RECIPES_DIR", storeDir: reach.store, repoVar: "RECIPE_REPO_ROOT", repoRoot: reach.repo })} Searches will list and run; SAVING one will fail.`);
  }

  // ── — THE DEMO POSTURE, AND WHY IT IS A FLAG ON THIS COMMAND ────────────
  //
  // `clearotron demo` used to serve driver/dev-portal.mjs, whose own first paragraph says it is not the
  // product. It brings up THIS supervisor now, because the alternative — a second portal with a demo
  // branch in it — is exactly how there came to be two portals to explain. One supervisor, one service,
  // three differences, all of them stated here:
  //
  //   the data directory   ~/trademark-demo, so a demo and a real install never meet and trying the
  //                        demo first costs a real `start` no migration and no cleanup.
  //   nothing persisted    no secrets and no address written to <repo>/.env. A visitor's demo must not
  //                        decide who signs in to the reader's real install afterwards.
  //   ordering resolves    CLEAROTRON_DEMO, read by the portal and by the MCP door. The four products
  //                        are listed and ORDERABLE, the form, the plan and the confirmation are the
  //                        product's own, and the confirmation resolves to a finished report that
  //                        already exists — no engine turn, no register call, no queue entry, no run
  //                        directory. A product the demo carries no report for refuses and names which.
  //                        (Owner ruling 2026-08-31 14:47, superseding the greyed-control ruling of
  //                        14:44 the same day: "a demo that shows four finished reports and a dead
  //                        button demonstrates the output and hides the thing a buyer is deciding
  //                        about". The greyed control was "a viewer creeping back in".)
  //   the boot lines       the same flag re-aims two warnings written for an operator of a real
  //                        deployment at the visitor who is not one, from one composer shared by both
  //                        processes (driver/demo-posture.mjs). Outside a demo they are unchanged.
  //
  // The loopback rule needs no copying: HOST above is a literal, not a default, so neither door can be
  // bound anywhere else in any mode. Sign-in is untouched — the demo signs in like any first start, and
  // the portal mints and prints its passphrase exactly as it does for a real one.
  const DEMO = argv.includes("--demo");
  const portFlag = flag("--port");
  if (portFlag) {
    const n = Number(portFlag);
    if (!Number.isInteger(n) || n < 1 || n > 65535) fatal(`--port ${portFlag} is not a port number (1–65535).`);
    ports.portal = n;
  }

  // Nobody is asked for this. A local install has one user, this machine already knows their name, and
  // the address never leaves the machine — `--user` is there for a reader who wants their real one, and
  // whatever is resolved here is written to `.env` so the question is never put twice.
  let whoami = "user";
  try { whoami = userInfo().username || "user"; } catch { /* a container with no passwd entry */ }
  // In a demo the address is the demo's own and is never written anywhere: see the DEMO block above.
  const user = String(flag("--user", DEMO ? "demo@localhost" : (process.env.PORTAL_LOCAL_USER || `${whoami}@localhost`))).trim().toLowerCase();
  if (!user.includes("@") || user.indexOf("@") !== user.lastIndexOf("@"))
    fatal(`--user "${user}" is not a single email address. It is the one identity that signs in here, and the portal refuses a multi-@ identity outright.`);
  const staffDomains = process.env.PORTAL_STAFF_DOMAINS || staffDomainFor(user);

  say("");
  say(`  ${BRAND.name} ${BRAND.product.toLowerCase()} — local install`);
  say("");
  // The pool, not the base directory: an environment that already names CLEAROTRON_REPORTS_DIR wins over
  // `--base`, so printing the base would name a directory this run may not be using.
  say(`  reports        ${paths.pool}`);
  say(`  signs in as    ${user}`);

  // ── THE PORTS, PROBED BEFORE ANYTHING IS WRITTEN ('s sibling,) ──
  //
  // This block used to sit in section 4, after the secrets were minted, the data plane created, the
  // grants file written and an example report seeded. So a box where another copy already held the port
  // printed five state-changing lines and THEN refused — leaving a reader unable to answer the only
  // question that matters: is my install half-made, and is it safe to run this again.
  //
  // The refusal itself is right and unchanged. `start` will not quietly move to another port, because
  // whatever is in front of it is still addressed to the port the reader was told to use. What was wrong
  // is that it applied that principle after acting on the opposite one.
  //
  // The sibling command already states the rule this now keeps: `install` says in its own header that
  // NOTHING IS WRITTEN until every credential has been checked. `start` holds itself to it now.
  //
  // It is one check out of order rather than a design: the installed-units refusal and the auth-mode
  // refusal above already run before any write, and `ports` is resolved above them. Nothing had to move
  // except this.
  const probe = (port) => new Promise((resolve) => {
    const s = createServer();
    s.once("error", (e) => resolve(e.code || "EUNKNOWN"));
    s.once("listening", () => s.close(() => resolve(null)));
    s.listen(port, HOST);
  });
  // ALL THREE DOORS, NOT TWO ( — bb8's F11). The client door's port is resolved
  // beside the other two, three lines up, and was left out of the loop written for exactly this
  // principle. So a held client port was discovered AFTER the portal and the engine door had bound: the
  // run fatalled mid-flight, tore down what it had started, and then did not exit — measured at rc=124
  // on a 120-second and a 300-second timeout. Refusing here costs nothing and leaves nothing to tear
  // down, which is what the paragraph above says this check is for.
  for (const [what, port, portVar] of [["portal", ports.portal, "PORTAL_SERVICE_PORT"], ["engine door", ports.mcp, "TRADEMARK_MCP_HTTP_PORT"], ["client door", ports.client, "CLIENT_MCP_HTTP_PORT"]]) {
    // A --background REFRESH runs over its own healthy units, which hold these ports on purpose;
    // systemd's restart is the handover. Probing would refuse the flag exactly once it has worked.
    // The narrow carve above already proved every installed unit is ours.
    if (backgroundRefresh) break;
    const code = await probe(port);
    // 's wording, not a second copy of it. That helper already distinguishes EADDRINUSE from EACCES
    // on a privileged port and from an address this host does not have, and names the way out of each;
    // the launcher having its own shorter sentence for one of the three would mean a user meets two
    // different answers to the same question depending on which door refused first.
    if (code) fatal(listenErrorMessage({ code }, { what, host: HOST, port, portVar }));
  }

  // ── 2. the two secrets, generated once and kept ────────────────────────────────────────────────────

  // From here down this run CHANGES the box. Everything above — the units gate, the auth-mode gate,
  // the port probe — refuses with nothing to clean up; a fatal below carries the re-running-is-safe
  // line because the reader's screen now holds state-changing lines above the refusal.
  markStateWritten();

  const generated = {};
  const secretFor = (name) => {
    if (process.env[name]) return process.env[name];
    // 32 random bytes, base64url so the value is safe unquoted in a parsed `.env` (parseEnv does no
    // shell expansion, and base64url has no `$`, no quote and no newline).
    const v = randomBytes(32).toString("base64url");
    generated[name] = v;
    return v;
  };
  const portalSecret = secretFor("PORTAL_SECRET");
  const tokenSecret = secretFor("TRADEMARK_MCP_TOKEN_SECRET");
  if (!process.env.PORTAL_LOCAL_USER) generated.PORTAL_LOCAL_USER = user;

  // A DEMO WRITES NO SECRETS AND NO ADDRESS. They are generated per run and live in memory only, which
  // is the same posture the ops key already has here — and it is what makes "removing the demo is one
  // directory" true rather than nearly true.
  if (Object.keys(generated).length && !DEMO) {
    let existing = "";
    try { existing = readFileSync(ENV_PATH, "utf8"); } catch (e) { if (e.code !== "ENOENT") fatal(`${ENV_PATH} exists but could not be read (${e.code}).`); }
    const merged = mergeEnvFile(existing, generated);
    if (merged.added.length) {
      // The house atomic-secret write: beside the target on the same filesystem, mode fixed BEFORE the
      // file is visible under its real name, then renamed over.
      const tmp = `${ENV_PATH}.tmp-${process.pid}`;
      try {
        writeFileSync(tmp, merged.text, { mode: 0o600 });
        chmodSync(tmp, 0o600);
        renameSync(tmp, ENV_PATH);
      } catch (e) {
        try { if (existsSync(tmp)) unlinkSync(tmp); } catch { /* nothing to clean */ }
        fatal(`could not write ${ENV_PATH} (${String(e?.message ?? e)}).`);
      }
      // NAMES only. This file is where the credentials are.
      say(`  wrote          ${merged.added.join(", ")} to ${ENV_PATH} (mode 600)`);
    }
  }
  process.env.TRADEMARK_MCP_TOKEN_SECRET = tokenSecret;   // mintToken reads it from the environment

  // ── 3. the data plane, and the roster the ops key is capped to ─────────────────────────────────────

  // Never the code default. `CLEAROTRON_REPORTS_DIR` USED TO fall back to /srv/trademark-archive, real client
  // matter on a deployed machine; removed that default outright, so unset now refuses and names the
  // variable instead. Every path here stays explicit either way, for the same reason `npm run example`
  // passes each one rather than letting a default choose — and so this block never depends on which of
  // those two an unset variable currently means.
  for (const d of [paths.pool, paths.workspace, paths.queue, paths.outbox, paths.locks, paths.recipes]) {
    try { mkdirSync(d, { recursive: true }); } catch (e) { fatal(`could not create ${d} (${String(e?.message ?? e)}).`); }
  }
  if (!existsSync(paths.grants)) {
    // An empty roster is the correct starting state: it admits the staff domain above and grants no
    // client anything. What is not legitimate is having no file — the portal refuses to start without
    // one, because with no grants file every admitted identity resolves to every account.
    try { writeFileSync(paths.grants, `${JSON.stringify({ tenants: {} }, null, 2)}\n`); }
    catch (e) { fatal(`could not create the grants file at ${paths.grants} (${String(e?.message ?? e)}).`); }
    say(`  created        ${paths.grants} (an empty roster — one staff address, no clients yet)`);
  }
  // THE REVOCATION LIST, CREATED — not merely named (, bb8's F14).
  //
  // The door is started with TRADEMARK_MCP_TOKEN_DENYLIST pointing here, and since this branch
  // `isRevoked` fails CLOSED on an unreadable file — it refuses the token rather than assuming it was
  // never revoked. It used to fail OPEN, and that is what the defect below was made of. Creating the
  // file is what keeps the closed contract from turning into an outage on an ordinary install: `key issue` tells an operator to revoke by writing a jti into it, `disconnect` writes
  // one, every check looks done — and the revoked key keeps answering 200. Measured on a default
  // install: revoke, then a full handshake, with nothing logged.
  //
  // `connect` has armed AND created this since 2082, with a comment saying exactly why. `start` named it
  // and created nothing, so one of the two doors stood outside a guard the other one had. Same helper
  // now, so a third door cannot be added outside it either.
  {
    const denylist = paths.denylist ?? denylistPathFor(process.env, homedir());
    try {
      const r = ensureDenylistFile(denylist, {
        exists: existsSync,
        dirname: (x) => dirname(x),
        mkdir: (d) => mkdirSync(d, { recursive: true }),
        write: (f, text) => writeFileSync(f, text, { mode: 0o600 }),
        read: (f) => readFileSync(f, "utf8"),
      });
      if (r.created) say(`  created        ${denylist} (the revocation list — a key revoked before it existed was not revoked at all)`);
    } catch (e) {
      // FATAL, and this is the one place that judgement belongs. A door that cannot consult its
      // revocation list is a door that cannot be revoked from, and starting it anyway is the failure
      // this whole finding is about — the run must not continue "successfully" into that state.
      fatal(`could not use the revocation list at ${denylist} (${String(e?.message ?? e)}).\n`
        + "  The client door reads this file on every key check and treats an unreadable one as \"not revoked\",\n"
        + "  so starting without it would make every revocation silently ineffective.");
    }
  }

  if (!existsSync(join(paths.configStore, ".git"))) {
    // recipe-service saves a search by committing it. Without a repository the save fails at the git
    // call with a message about the git call, which says nothing about saved searches.
    try {
      mkdirSync(paths.configStore, { recursive: true });
      execFileSync("git", ["-C", paths.configStore, "init", "-q", "-b", "main"], { stdio: "ignore" });
      execFileSync("git", ["-C", paths.configStore, "config", "user.email", user], { stdio: "ignore" });
      execFileSync("git", ["-C", paths.configStore, "config", "user.name", `${BRAND.name} local install`], { stdio: "ignore" });
      execFileSync("git", ["-C", paths.configStore, "commit", "-q", "--allow-empty", "-m", "local config store"], { stdio: "ignore" });
      say(`  created        ${paths.configStore} (the saved-search store, a git repository)`);
    } catch (e) {
      // Said out loud rather than discovered later: everything else works, and the first Save on a
      // search is what will fail.
      err(`  WARNING: could not initialise the saved-search store at ${paths.configStore} (${String(e?.message ?? e)}). Searches will list and run; SAVING one will fail until this is a git repository.`);
    }
  }

  // — AN INSTALL COMES UP WITH SOMETHING IN IT.
  //
  // A fresh start used to produce a working portal over an empty archive: nothing to look at, and the
  // only way to get a report was to run a real clearance with real credentials. This replays the frozen
  // samples through the ordinary publisher — the same path `npm run example` uses, no credentials, no
  // model, no engine — and it seeds ONLY a pool that holds no runs, so this is a first-start event and
  // a restart re-publishes nothing. The guard is emptiness rather than a list of forbidden paths,
  // because on a customer's machine their pool IS the real archive and no list of ours names it;
  // seed-pool.mjs carries that reasoning in full.
  //
  // ONE sample ships today (a multi-country focus search). Three of the four products have no finished
  // run anywhere to freeze — see — so this seeds what exists and picks the rest up unchanged when
  // they are captured.
  // ── F23 — A REAL INSTALL STARTS EMPTY (OWNER RULING, 2026-09-04) ────────
  //
  // Owner, in session, on his first real start: "critical, it started and I still see a demo report in
  // the actual product. Should not be there — should ONLY be in demo. Proper product should have no
  // previous reports." Measured on that box: a fictional clearance sat in
  // /home/clearotron/trademark/pool — the directory that install publishes REAL CLIENT MATTERS into,
  // written the moment `start` first ran.
  //
  // DORMANT, NOT DELETED, and that is the ruling's own shape rather than a softer reading of it. His
  // words put the sample in one place and take it out of the other, so the seeding is gated on the demo
  // posture and stays whole: `--demo` is the deployment whose entire purpose is having something to
  // look at without credentials, and deleting the path would take that away to fix a problem it does
  // not have.
  //
  // THE FIRST-START GUARD BELOW IS NOT THIS GUARD, and keeping the two apart matters. Emptiness answers
  // "has this pool been seeded already"; it never answered "is this pool a customer's". On a fresh real
  // install the pool IS empty, which is exactly why the sample landed there and why no re-run was
  // needed to notice it.
  if (!DEMO) {
    // Said out loud rather than silently skipped: an operator who read the old line and expects it is
    // owed the reason it is gone, and "the archive is empty" and "the archive is empty and nobody said
    // why" look identical in a browser — the same argument the seeding path already makes below.
    say(`  archive        empty, which is what a real install starts with`);
    say(`                 \`${invocationPrefix()}clearotron demo\` replays a finished example without touching this install.`);
  } else try {
    const { seedPool } = await import("../driver/publish/seed-pool.mjs");
    const { republishRun } = await import("../driver/publish/report-registry.mjs");
    const seed = await seedPool({ pool: paths.pool, examplesDir: join(REPO, "demo"), republish: republishRun });
    if (seed.seeded.length) {
      say(`  seeded         ${seed.seeded.length} example report(s) into ${paths.pool}`);
      // THE LABEL. is delivered: the report now carries the owner's own sample sentence on its
      // own face — topbar, lead and footer — so this line is no longer the only place a reader could
      // learn what the document is. It stays because it says something the document cannot: that
      // REPLAYING it queries nothing and spends nothing, which is a fact about this command rather than
      // about the clearance. The two are not in tension — the sample was produced against real data and
      // is served from frozen artifacts — and the document's own wording is the owner's to set.
      say("                 Real engine output for a fictional mark, replayed from frozen artifacts:");
      say("                 no keys, no model calls, no register queried. An example, not advice.");
    }
    // Never a silent nothing. "The archive is empty" and "the archive is empty and nobody noticed why"
    // look identical in the browser, so both other outcomes are said out loud.
    for (const p of seed.problems) err(`  WARNING: sample seeding — ${p}`);
  } catch (e) {
    err(`  WARNING: the example report could not be seeded (${String(e?.message ?? e)}) — the archive will come up empty. Everything else works; \`npm run example\` shows a sample without touching this install.`);
  }

  let roster = [];
  try {
    const { loadProfiles } = await import("../driver/profiles.mjs");
    roster = [...loadProfiles({ force: true }).keys()].sort();
  } catch (e) {
    err(`  WARNING: the customer roster could not be read (${String(e?.message ?? e)}) — the trigger key cannot be capped to it.`);
  }

  const { mintToken } = await import("../shared/scope.mjs");
  let opsToken;
  try {
    // TWO walls, by construction. The key names the verbs it may use and the accounts it may start for,
    // so the portal's own principal check is not the only thing bounding a trigger. Capped to the roster
    // THIS install can see — the same list the face validates `profileKey` against, so the cap and the
    // validation cannot disagree. Minted fresh every start: never written down, never near expiry.
    opsToken = mintToken({ scope: "ops", sub: "portal", verbs: ["start_run", "stop_run"], accounts: roster.length ? roster : null, ttlSec: 30 * 24 * 3600 });
  } catch (e) { fatal(`could not mint the trigger key (${String(e?.message ?? e)}).`); }
  if (!roster.length) err("  WARNING: no customer profiles were found, so the trigger key is NOT account-capped.");

  // F26 — an operator who has deliberately turned account access off keeps it off. Read from this
  // process's resolved environment, which is where `<repo>/.env` has already been applied, so a
  // decision recorded in that file survives a start rather than being silently overwritten with "1".
  const declaredFence = String(process.env.CLIENT_MCP_ACCOUNT_ACCESS ?? "").trim();
  const envs = childEnv({ ports, paths, user, staffDomains, portalSecret, tokenSecret, opsToken,
    localWorker: wantWorker, demo: DEMO, clientFence: declaredFence || null });

  // ── 3b. the configuration snapshot, so the portal can name this install's MODE ────────────────────
  //
  // — THIS IS THE ONE FIRST-RUN ENTRY THAT CAN WRITE ONE. `driver/portal-service.mjs`
  // deliberately has no engine environment and says so three times in one block, so it cannot compute
  // whether an engine is present — it can only READ a snapshot. And nothing wrote one on a fresh
  // install: `buildFlagSnapshot` had no runtime caller outside its own module and the tests, and
  // neither this file nor `bin/example.mjs` touched it. So the install where naming the mode matters
  // most — a first-time visitor who has never run anything — was the one where the portal's only
  // channel answered `engine: null`.
  //
  // BEST EFFORT, AND LOUD ABOUT IT. A snapshot is a diagnostic surface, not a precondition for
  // serving: refusing to start a working portal because a JSON file could not be written would be a
  // worse outcome than the portal saying it cannot answer. But it is never silent — a missing snapshot
  // is exactly the state this issue is about, so the reason is printed rather than swallowed.
  // ── THE DEMO HANDS ITS OWN INSTALL OVER, BECAUSE NOTHING ELSE WILL ────
  //
  // A `start` writes `.env` and reads it back, so this process already carries the install's paths.
  // A demo writes nothing — that is what makes "removing the demo is one directory" true — so the
  // children got the install through `childEnv` and this call got an environment nobody had set.
  // `config.poolRoot` threw by name, and the visitor's FIRST screen carried "the configuration
  // snapshot could not be written", naming a deployed server's archive path, followed by the portal
  // saying its configuration page cannot answer. Exactly the reader the paragraph above names.
  //
  // ONLY IN DEMO MODE. On a real start an operator's own `CLEAROTRON_REPORTS_DIR` deliberately wins
  // over the computed path (see the resolution site), and forcing `paths.pool` here would overrule
  // them. `envs.worker` is the shared block — the install's paths in both spellings and nothing
  // else — so engine and provider identity still resolve from the real environment and report,
  // honestly, that a demo carries no credentials.
  try {
    const { writeFlagSnapshot } = await import("../driver/flag-snapshot.mjs");
    const { path } = await writeFlagSnapshot(DEMO
      ? { quiet: true, env: { ...process.env, ...envs.worker }, poolRoot: paths.pool }
      : { quiet: true });
    say(`  configuration snapshot: ${path}`);
  } catch (e) {
    err(`  WARNING: the configuration snapshot could not be written (${String(e?.message ?? e)}).`);
    err("  The portal will serve normally and its configuration page will say it cannot answer.");
  }

  // ── 4b. --background: the same product, surviving the terminal ──────────────
  //
  // The owner's expectation, verbatim: "someone just runs clearotron connect and start and backgrounds
  // the processes and thats it its done". The foreground supervisor dies with the terminal — his portal
  // was gone between two of his own sessions and every screen spun. The honest fix on a machine with
  // systemd is not a detach flag and a pid file; it is the same user units a server runs, installed for
  // exactly the pinned BACKGROUND_UNITS set (the census arm keeps that pin honest). Since tracker issue
  // 2148 settled point 2 that set INCLUDES the client door, which is why the block below writes the
  // door's settings before any unit is placed.
  //
  // THE UNITS READ %h/.env, NOT THIS PROCESS'S ENV. Everything the foreground supervisor would have
  // HANDED its children must therefore be WRITTEN — the union of the child envs, add-only (a value the
  // operator put there wins), plus CLEAROTRON_CHECKOUT_DIR for the units' ExecStart. Add-only is also
  // what makes re-running safe, and the same idempotence sentence the foreground fatal carries applies.
  if (wantBackground) {
    const HOME_ENV = join(homedir(), ".env");
    const union = { ...envs.mcp, ...envs.portal, ...(envs.worker ?? {}),
      "CLEAROTRON_CHECKOUT_DIR": REPO };

    // ── — WHAT THE FOREGROUND HANDED OVER BY INHERITANCE, WRITTEN DOWN ─────
    //
    // The block above carries what this supervisor DERIVES — ports, paths, door secrets. In the
    // foreground that was enough, because a child inherits the rest from this process, which read the
    // configuration at import. The units do not inherit: they read `%h/.env` with
    // `CLEAROTRON_NO_ENV_FILE=1`, deliberately, so an inherited value is exactly what does not arrive.
    //
    // MEASURED CONSEQUENCE, on a box that had delivered a real report an hour earlier: the paths and the
    // door secrets travelled and the register, its credential, the research key, the engine and the
    // engine path did not. A Knockout search ordered over MCP failed at its first stage, and the client
    // was told "nothing was delivered. Clearotron has been notified" on a box with no outbox.
    //
    // So the values a run needs are carried from the configuration this process is holding. NOT the
    // whole environment: writing `process.env` into a file on the operator's home directory would put
    // every unrelated secret in their shell into it. The names come from the one authority that also
    // guards them below — a composer and a checker that disagree fail in the direction where the
    // checker passes because it asked for less than the composer forgot.
    const RUN_TABLES = await runTables();
    for (const name of runRequiredNames(process.env, RUN_TABLES)) {
      const v = String(process.env[name] ?? "").trim();
      if (v && union[name] === undefined) union[name] = v;
    }
    // ── THE CLIENT DOOR IS IN THIS SET NOW, SO ITS SETTINGS MUST BE TOO ──────
    //
    // Settled point 2 put `clearotron-client-mcp.service` into SERVER_INSTALL_SET, which IS
    // BACKGROUND_UNITS — so the loop below installs it and `enable --now`s it. It refuses to start
    // without CLIENT_MCP_TOKEN_ONLY=1 (it otherwise demands an OIDC audience and an access team, which
    // a local install has neither of), and token-only requires the fence, the secret and the
    // allow-list. Without these six names this flag placed a door and crash-looped it.
    //
    // FROM `enablePlan`, NOT FROM A LIST HERE. Same authority `clearotron connect` calls and the same
    // authority the hosted install path calls, for the reason that function's header gives: the port
    // and the allow-list are derived from one number, and two authors produce a door that starts and
    // refuses every request. `issuesKey: false` — this flag mints no account key.
    const doorPlan = enablePlan({
      env: { ...process.env, ...union }, address: null, identity: null, issuesKey: false,
      checkoutDir: REPO, denylistPath: defaultDenylistPath(homedir()),
      unitEnvHasSecret: Boolean(String(union.TRADEMARK_MCP_TOKEN_SECRET ?? "").trim()),
    });
    if (!doorPlan.possible) {
      // The supervisor has just written the secret and the access file itself, so a refusal here means
      // something this process did not do — named, never swallowed, and before any unit is placed.
      fatal(`the client door's settings could not be resolved, so --background would install a unit that `
        + `cannot start: ${doorPlan.blockers.map((b) => b.why).join("; ")}`);
    }
    Object.assign(union, doorPlan.settings);

    // ── — THE START SEAM: REFUSE HERE, NOT AT THE CLIENT'S FIRST STAGE ─────
    //
    // BEFORE a unit is placed and before this command reports success, the environment the units will
    // actually read is checked against what a run needs. The alternative is what happened: a start that
    // said everything was fine, and a lawyer's search that died at its first stage with a stack trace,
    // delivering "nothing was delivered. Clearotron has been notified" on a box that notified nobody.
    //
    // CHECKED AGAINST `union`, WHICH IS WHAT THE FILE WILL SAY — plus what the file ALREADY says, since
    // `mergeEnvFile` is add-only and an operator's existing line wins. Checking `process.env` here would
    // measure this shell rather than the units, and pass on exactly the box that fails.
    //
    // BLOCKING REFUSES; NARROWING IS SAID OUT LOUD AND STARTS ANYWAY. A research key this box does not
    // hold means the three clearance searches refuse at preflight and a Knockout search still runs and
    // discloses what it skipped — so refusing to start over it would take a box that can serve a real
    // product and make it serve none. The operator is told which products this install can fill.
    {
      const already = {};
      try {
        for (const line of readFileSync(HOME_ENV, "utf8").split("\n")) {
          const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/.exec(line);
          if (m) already[m[1]] = m[2];
        }
      } catch { /* no file yet — the union is the whole of it */ }
      const willRead = { ...already, ...union };
      const miss = missingRequirements(willRead, RUN_TABLES);
      if (miss.blocking.length) {
        fatal(`--background would install units that cannot run a clearance. ${HOME_ENV} is what they read, and `
          + `it would not carry:\n`
          + miss.blocking.map((r) => `    ${r.name} — ${r.why}`).join("\n")
          + `\n\n  Nothing has been installed and nothing has been started. Set these where this command can see `
          + `them — \`${invoke("install")}\` writes them — and run this again. Refusing here rather than at a `
          + `client's first search, which is where this surfaced before: as a failed run and a notice saying `
          + `they had been notified.`);
      }
      for (const r of miss.narrowing)
        say(`  ⚠ ${r.name} is not set — ${r.why}`);
    }

    let homeText = "";
    try { homeText = readFileSync(HOME_ENV, "utf8"); } catch (e) { if (e.code !== "ENOENT") fatal(`${HOME_ENV} exists but could not be read (${e.code}).`); }
    const merged = mergeEnvFile(homeText, union);
    if (merged.added.length) {
      const tmp = `${HOME_ENV}.tmp-${process.pid}`;
      writeFileSync(tmp, merged.text, { mode: 0o600 });
      renameSync(tmp, HOME_ENV);
      say(`  ✓ ${HOME_ENV} — ${merged.added.length} value(s) added (existing lines untouched)`);
    } else say(`  ✓ ${HOME_ENV} already carries everything the units need`);
    // ── TWO ENV FILES, AND SAYING SO ( — F33) ──────────────────────────────
    //
    // A first `--background` leaves an install with two: this one, which the UNITS load, and the
    // checkout's own `.env`, which the CLI reads. Neither output mentioned the other's existence, and
    // that silence is the substrate under F34 and F40 — and under every future "I edited the config and
    // nothing changed". Named here, at the moment the second one appears, because that is the only
    // point where a reader is looking at the thing that would otherwise surprise them later.
    if (ENV_PATH !== HOME_ENV) {
      say(`    This install now has TWO environment files, and they are read by different things:`);
      say(`      ${HOME_ENV}  — the UNITS load this one. It is what the running product uses.`);
      say(`      ${ENV_PATH}  — the CLI reads this one when you type a command in a shell.`);
      say(`    Editing one does not change the other. To change what the RUNNING product does, edit the`);
      say(`    first and restart the units.`);
    }

    const UNIT_DIR = join(homedir(), ".config", "systemd", "user");
    mkdirSync(UNIT_DIR, { recursive: true });
    // RENDERED, never copied raw: a tracked unit can carry an @PLACEHOLDER@ (the path watcher's
    // workspace root — a .path unit cannot read an environment variable, so the value is baked at
    // install). A raw copy ships the token and systemd refuses the file as bad-setting — found by
    // driving this flag, not by reading it. Values resolve from the same union the env file carries.
    const { renderUnit } = await import("../driver/systemd/render-units.mjs");
    for (const u of BACKGROUND_UNITS) {
      const text = readFileSync(join(REPO, "driver", "systemd", u), "utf8");
      writeFileSync(join(UNIT_DIR, u), renderUnit(text, { ...process.env, ...union }));
    }
    try { execFileSync("systemctl", ["--user", "daemon-reload"], { stdio: "ignore" }); }
    // ── BOTH REMEDIES, BECAUSE TWO INDEPENDENT THINGS CAN BE MISSING (Refs issue 2176 — F32) ──────
    //
    // This named the problem and stopped one sentence short, leaving an operator to work out which of
    // two unrelated causes they had. Lingering is a real product prerequisite documented nowhere; the
    // bus variable is an artefact of HOW the account was entered — a person who ssh's in as themselves
    // gets it from PAM and never sees this. "An admin becomes a service account with `sudo -i`" is the
    // common shape for exactly this install, and the product knows the uid, so it can name both rather
    // than make the reader guess which applies.
    catch {
      const uid = process.getuid?.() ?? "$(id -u)";
      const who = userInfo().username;
      fatal("systemd's user manager is not reachable from this session — `--background` needs it.\n"
        + "  Two independent things cause this. Either may be the one:\n"
        + `    1. this account has no lingering user manager. As root:  loginctl enable-linger ${who}\n`
        + `    2. this shell was entered with \`su\`/\`sudo -i\`, which leaves the bus unset. In it:\n`
        + `         export XDG_RUNTIME_DIR=/run/user/${uid}\n`
        + `         export DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/${uid}/bus\n`
        + "  Or run without the flag: the product starts in the foreground and stops when you close it.");
    }
    // DISARM BEFORE ENABLING, so the box never holds the retired drainer and its replacement at once.
    // `disable --now` on a unit that is not installed is a no-op, so this needs no existence check and
    // is safe on a box that never had them.
    for (const u of BACKGROUND_RETIRED) {
      try { execFileSync("systemctl", ["--user", "disable", "--now", u], { stdio: "ignore" }); }
      catch { /* not installed, or already down — both are the state we want */ }
    }
    for (const u of BACKGROUND_UNITS) execFileSync("systemctl", ["--user", "enable", "--now", u], { stdio: "ignore" });
    // enable --now on an ALREADY-ACTIVE unit is a no-op, so a refresh would leave the old process
    // running the old files. EVERY long-running unit in the set is restarted, not a hardcoded pair
    // (, Hera's review): the pair here matched the pair the health check used three
    // lines down, and carried the same stale justification about "the oneshot and its triggers". There
    // is no oneshot in the set. So a refresh restarted the portal and the engine door onto new code and
    // left the worker and the client door on the old — while the check below now reports all four up,
    // which made a more confident report over an unchanged restart. Measured on the test box:
    // `enable --now` left MainPID unchanged.
    if (backgroundRefresh) for (const u of unitsToRestartOnRefresh(BACKGROUND_UNITS, unitTypeOf)) {
      try { execFileSync("systemctl", ["--user", "restart", u], { stdio: "ignore" }); } catch { /* health check below reports it */ }
    }

    // STARTED IS NOT RUNNING (the connect lesson): settle, then read each service's own state.
    //
    // EVERY UNIT THIS FLAG INSTALLS, DERIVED FROM THE SET ( — bb8's F15). This checked
    // a hardcoded PAIR while `enable --now` had just started FOUR. So a client door crash-looping against
    // a held port got no ✗, was never named in the banner, and `start --background` printed its success
    // block and exited 0 over a product that was two-thirds up. The worker was unchecked for the same
    // reason.
    //
    // The comment here used to justify the gap: "the oneshot worker and its timer/path are judged by
    // being enabled". That is stale — clearotron-worker.service is `runner.mjs --watch`, Type=simple,
    // Restart=on-failure, and there is no timer or path unit in the install set at all. It described the
    // retired prelim-* units. A stale justification is worse than none: it reads as a decision.
    //
    // Judged by the unit's OWN declared Type rather than by a list kept here, so a oneshot added to the
    // set later is judged correctly instead of being reported as broken for exiting.
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 3000);
    const sickUnits = [];
    for (const u of BACKGROUND_UNITS) {
      const type = unitTypeOf(u);
      let f = {};
      try {
        const out = execFileSync("systemctl", ["--user", "show", u, "-p", "ActiveState", "-p", "SubState", "-p", "NRestarts", "-p", "UnitFileState"], { encoding: "utf8" });
        f = Object.fromEntries(out.trim().split("\n").map((l) => l.split("=")));
      } catch { /* unreadable state is reported below as not-running */ }
      const verdict = unitHealthVerdict({ type, activeState: f.ActiveState ?? null, subState: f.SubState ?? null,
        unitFileState: f.UnitFileState ?? null, nRestarts: f.NRestarts ?? 0 });
      if (type === "oneshot") {
        if (verdict.ok) say(`  ✓ ${u} is enabled (oneshot — exiting is how it succeeds)`);
        else { sickUnits.push(u); err(`  ✗ ${u} is NOT enabled (${f.UnitFileState ?? "unreadable"}) — journalctl --user -u ${u} -n 30`); }
        continue;
      }
      // NRestarts IS A LIFETIME COUNTER, AND IT DOES NOT DECIDE THIS. It counts
      // every restart since the unit was loaded, so a unit that crash-looped, recovered, and has served
      // ever since carries a non-zero count while reading `active/running` — and requiring "0" made
      // `start --background` print "✗ … is NOT running (active/running, restarts 15)" and exit 1 on a
      // healthy box. The condition predates this file's F15 change; that change extended it from two
      // units to four and so doubled what it could block. The real crash loop is already caught by the
      // state pair: a looping unit reads `activating/auto-restart`, never `active/running`.
      //
      // AND THE COUNT IS NOT PRINTED HERE, which is a correction to what this file did first. It cannot
      // be non-zero on this path: either the units were just installed and start at zero, or this is a
      // refresh — `backgroundRefresh`, above — which restarts all four before this loop reads them, and
      // an explicit `systemctl restart` sets the counter to 0 — measured on systemd 255.4-1ubuntu8.17,
      // and the version is part of the claim because that reset is not documented contract. An earlier
      // note here said only `reset-failed` cleared it, unmeasured, and that was wrong. A unit that
      // begins looping BETWEEN
      // the restart and this read shows `activating/auto-restart` and takes the ✗ branch below.
      //
      // So the history line was unreachable prose. It belongs where somebody asks about a box they did
      // not just restart, which is `doctor` — see `bin/onboard.mjs`.
      if (verdict.ok) say(`  ✓ ${u} is up`);
      else { sickUnits.push(u); err(`  ✗ ${u} is NOT running (${f.ActiveState ?? "unreadable"}/${f.SubState ?? "?"}, restarts ${f.NRestarts ?? "?"}) — read its own words: journalctl --user -u ${u} -n 30`); }
    }
    if (sickUnits.length) {
      // NAMED IN THE FAILURE, not merely counted: the operator's next command is about one unit.
      err(`\n  ${sickUnits.length} of ${BACKGROUND_UNITS.length} unit(s) did not come up: ${sickUnits.join(", ")}`);
      err("  The units are installed but not healthy — nothing is hidden by this flag: the journal");
      err("  lines above are the same errors the foreground run would have printed.");
      process.exit(1);
    }
    say("");
    say(`  Open:            ${envs.url}`);
    say("  This SURVIVES the terminal — close the window, the product keeps running.");
    say(`  Stop it:         ${invoke("stop")}   (stops and removes the units; issued connect keys survive — \`${invoke("disconnect")}\` revokes those)`);
    say(`  Is it up?        ${invoke("status")}`);
    process.exit(0);
  }

  // ── 5. start them, and stop them together ──────────────────────────────────────────────────────────

  const children = [];
  let stopping = false;

  const start = (name, script, env, { args = [], fatal = true } = {}) => {
    const child = spawn(process.execPath, [join(REPO, script), ...args], {
      cwd: REPO,
      // Its OWN process group, so Ctrl-C reaches this supervisor alone and teardown is one ordered
      // sequence rather than a race between the terminal's signal and ours. It also means the group
      // kill below reaches anything a child spawns, not just the child.
      detached: true,
      stdio: ["ignore", "inherit", "inherit"],
      env: { ...process.env, ...env },
    });
    const rec = { name, script, child, alive: true };
    children.push(rec);
    child.on("exit", (code, signal) => {
      rec.alive = false;
      if (stopping) return;
      // REPORTED. Not absorbed into a panel that says a service is unreachable.
      if (!fatal) {
        // Loudly, because the queue stops draining the instant this goes — but the portal keeps serving,
        // which is the whole point of a child this install is supported without.
        err(`\nstart: ${name} (${script}) exited ${signal ? `on ${signal}` : `with code ${code}`} — the portal is still up,`
          + ` but nothing is draining the queue now. Start one with:\n    node ${script} --watch\n`);
        return;
      }
      err(`\nstart: ${name} (${script}) exited ${signal ? `on ${signal}` : `with code ${code}`} — its own output above says why. Stopping the rest.\n`);
      void shutdown(1);
    });
    child.on("error", (e) => {
      rec.alive = false;
      if (stopping) return;
      if (!fatal) {
        err(`\nstart: ${name} (${script}) could not be started: ${String(e?.message ?? e)} — the portal is still up,`
          + ` but the queue will not drain.\n`);
        return;
      }
      err(`\nstart: ${name} (${script}) could not be started: ${String(e?.message ?? e)}\n`);
      void shutdown(1);
    });
    return rec;
  };

  const signalGroup = (rec, sig) => { try { process.kill(-rec.child.pid, sig); } catch { /* already gone */ } };

  async function shutdown(code) {
    if (stopping) return;
    stopping = true;
    const live = children.filter((c) => c.alive);
    if (live.length) {
      say(`\n  stopping ${live.map((c) => c.name).join(" and ")}…`);
      for (const c of live) signalGroup(c, "SIGTERM");
      // A grace window, then the hammer. Nothing this command starts holds unflushed client state, so
      // the window is short; it exists so a service gets to close its listener and log its own line.
      const deadline = Date.now() + 5000;
      while (children.some((c) => c.alive) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 100));
      for (const c of children.filter((x) => x.alive)) {
        err(`  ${c.name} did not stop on SIGTERM — killing it.`);
        signalGroup(c, "SIGKILL");
      }
      await new Promise((r) => setTimeout(r, 200));
    }
    process.exit(code);
  }

  // Ctrl-C, and whatever a terminal or a parent supervisor sends. Both land on the same teardown, and
  // the `stopping` flag is what stops an orderly stop being reported as a crash.
  process.on("SIGINT", () => { void shutdown(0); });
  process.on("SIGTERM", () => { void shutdown(0); });

  const healthy = async (url, rec) => {
    const deadline = Date.now() + 30_000;
    for (;;) {
      if (!rec.alive) return false;                       // it died; its own exit handler is reporting it
      try { if ((await fetch(url, { signal: AbortSignal.timeout(2000) })).ok) return true; } catch { /* not up yet */ }
      if (Date.now() > deadline) return false;
      await new Promise((r) => setTimeout(r, 250));
    }
  };

  // The face first: the portal reads its trigger key's posture at boot and logs what the lane is capped
  // to, so having the far end already listening keeps that line honest rather than optimistic.
  const mcp = start("the engine door", "mcp-server/http-server.mjs", envs.mcp);
  if (!await healthy(`http://${HOST}:${ports.mcp}/healthz`, mcp)) {
    if (mcp.alive) { err(`\nstart: the engine door did not answer on ${HOST}:${ports.mcp} within 30s — its output above says why.\n`); await shutdown(1); }
    await new Promise(() => {});   // its exit handler is already tearing down
  }

  // ── F22 — READ THE FACT BEFORE STARTING THE THING THAT CHANGES IT ───────
  //
  // Whether a sign-in credential already existed is a fact about the world BEFORE this run. The portal
  // mints one on its first start and prints the passphrase — the only time it is ever readable, since
  // nothing stores it in a form that can be read back — so a check made AFTER the spawn always answers
  // "it existed", including on the run that just created it.
  //
  // Measured on the owner's first real start: the portal printed `PASSPHRASE: <24 chars>`, and fourteen
  // lines later the same run told him it "was minted on an earlier start and is NOT reprinted". There
  // had been no earlier start. He was told to discard the one value on the screen that he could not
  // recover, seconds after it was shown to him.
  //
  // Captured HERE, immediately before the spawn, rather than beside the sentence that reads it: the
  // check has to sit on the other side of the thing that mints, and the only way to keep that true is
  // for it to be adjacent to the spawn where a reader can see why.
  const { credentialPathFor: credentialPathBeforeStart, newPassphrase } = await import("../driver/portal-local-auth.mjs");
  const credentialExisted = existsSync(credentialPathBeforeStart());

  // ── MINT HERE SO THE SUMMARY CAN PRINT IT ( — F10) ────────────────────────
  //
  // The owner, on his first demo run: "the URL is kind of hidden… same for the passphrase, it's really
  // hidden, I only KNEW to look for it." It arrived as the second-to-last of eleven consecutive
  // [portal-service] log lines, prefixed identically to the audit path and the token expiry beside it —
  // and it is the one value in this product that CANNOT be read back. Every other line in that wall is
  // recoverable information about paths and rosters. This one is not, and it looked exactly like them.
  //
  // The summary could not carry it because the mint happened in the portal CHILD, after the banner was
  // composed. So the supervisor mints instead, and hands it down.
  //
  // HANDED AT THE SPAWN CALL, NOT PUT IN `envs.portal`. That composition is ALSO what `--background`
  // writes into the units' env file, so a passphrase placed there would become a permanent plaintext
  // copy on disk — and the product's own sentence, "it is stored only as a digest", would be false.
  // Structurally excluded rather than filtered: the union cannot carry a key the object never had.
  const mintedPassphrase = credentialExisted ? null : newPassphrase();

  const portal = start("the portal", "driver/portal-service.mjs",
    mintedPassphrase ? { ...envs.portal, PORTAL_LOCAL_PASSPHRASE: mintedPassphrase } : envs.portal);
  if (!await healthy(`http://${HOST}:${ports.portal}/portal/health`, portal)) {
    if (portal.alive) { err(`\nstart: the portal did not answer on ${HOST}:${ports.portal} within 30s — its output above says why.\n`); await shutdown(1); }
    await new Promise(() => {});
  }

  // ── 5b. the worker, on the local posture only ────────────────────────────────────────────────────
  //
  // A local install drains its own queue. The split — order in the portal, drain in a second terminal —
  // is right on a shared deployment, where the person who clicks Start is not the person who pays for the
  // drain. On one laptop it is a trap: the same person does both, and they have already said yes once.
  //
  // THIS ADDS NO CONSENT, AND IT DOES NOT NEED TO. The portal already prices the run, quotes how long it
  // takes, and asks for confirmation before anything is spent. Until now that promise was false in the
  // reader's favour: confirming enqueued, and nothing was spent until a command they had to read about
  // in the closing block below. The worker makes the consent the product already obtains TRUE.
  // (The dialog used to carry that promise as a sentence. It is RETIRED and is not to be restored: on a
  // subscription it is not a spend, and the owner's word on is that the sentence was
  // ours rather than his. What the dialog DOES is unchanged, which is why this paragraph still holds —
  // the consent is in the behaviour, and it never needed a line on the screen to be real.)
  //
  // Not a new default anywhere else, and nothing here infers "am I a laptop": systemd deployments never
  // enter this file, so the local posture is simply being started by this command.
  //
  // `--watch` is the runner's own no-systemd loop — the SAME `main({ once: true })` the timer calls, on
  // the timer's own 90s cadence. Concurrency is unchanged: every run acquires the shared slot lock in
  // CLEAROTRON_RUN_LOCK_DIR, so this worker and a hand-started `node driver/runner.mjs` share ONE cap rather
  // than becoming two lanes.
  //
  // NON-FATAL on purpose. An install with no worker is a supported state (--no-worker), so a worker that
  // dies must leave the portal serving rather than take the whole install down with it.
  const worker = wantWorker
    ? start("the worker", "driver/runner.mjs", envs.worker, { args: ["--watch"], fatal: false })
    : null;

  // ── 5c. the client door — the OTHER door, on this path too ( — F26) ───────
  //
  // NON-FATAL, for the reason the worker is. An install serving the portal with no client door is a
  // supported state and a useful one; an install that refuses to come up at all because a door could
  // not bind is not. The door's own refusal is loud and carries its remedy — measured and recorded as
  // working — so a reader sees why in its output rather than losing the portal along with it.
  const clientDoor = start("the client door", "mcp-server/http-server-client.mjs", envs.client, { fatal: false });

  // ── 6. one URL ─────────────────────────────────────────────────────────────────────────────────────

  say("");
  say(`  Open   ${envs.url}`);
  say("");
  // ── TWO DOORS, TWO AUDIENCES, BOTH NAMED ( — F26) ─────────────────────────
  //
  // The output used to name neither as a door, so an owner watching one of them start concluded MCP had
  // not come up. Both are printed with who each is for, because "MCP is running" is ambiguous on a box
  // that has two of them and the ambiguity is what cost the leg.
  say(`  Engine door  http://${HOST}:${ports.mcp}/mcp   — the portal's Start button calls this. Staff.`);
  // THE SYNCHRONOUS TRUTH, NOT THE ASYNC FLAG ( — F26, review finding).
  //
  // `rec.alive` is flipped by the child's exit handler, which is async: reading it here asks "has the
  // event loop delivered the exit yet", and the answer is timing. Measured: a door with the F26 death
  // exits in 257ms and this line prints only after the portal answers an HTTP probe, so the margin is
  // real today — and nothing pinned it. `child.exitCode` is set by the runtime the moment the process
  // is reaped, so it is the same fact without the race. The failure mode being avoided is this
  // finding's own defect relocated into its failure path: a dead door announced as one a client's
  // assistant connects to, which is worse than the silence F26 replaced.
  const doorRunning = clientDoor?.child?.exitCode === null;
  if (doorRunning) {
    say(`  Client door  http://${HOST}:${ports.client}/mcp   — a client's assistant connects here.`);
    say(`               It refuses every caller until a key is issued: ${invocationPrefix()}clearotron key issue <email>`);
  } else {
    say(`  Client door  NOT RUNNING on ${HOST}:${ports.client} — its output above says why. The portal and`);
    say("               the engine door are unaffected; a client assistant cannot connect until it is up.");
  }
  say("");
  // — THE BANNER TOLD THE SAME STORY ON EVERY START, and it was only true of the first.
  //
  // "printed once, above" describes what a FIRST start does. On every start after it the passphrase was
  // minted days ago, to a terminal that may belong to a unit nobody watched — and the sentence sent the
  // reader scrolling for a line that was never going to be there. Read once, believed, and the recovery
  // it implied did not exist.
  //
  // Read from the credential file, not from a flag this process sets: the mint happens inside the
  // portal service, in another process, after this banner is composed. The file's existence BEFORE
  // start is the only thing this process can honestly know.
  // `credentialExisted` was captured BEFORE the portal was started — see the note at its declaration.
  // Reading it here would be reading it after the mint, which is the defect this replaced.
  // ── THE TWO THINGS A FIRST-TIME READER NEEDS, TOGETHER AND FRAMED (Refs issue 2175 — F10) ───────
  //
  // The owner's ask, verbatim: near the bottom, together, and visually unmistakable. Both were true of
  // neither before — the address and the passphrase were fourteen lines apart, in two registers, and
  // the summary SENT THE READER BACK UP into the log for a value the summary itself could have carried.
  // That the summary had to say "printed once, above" was the tell.
  //
  // The frame is not decoration. Every other line of that startup wall is a [portal-service]-prefixed
  // log line about paths, rosters and token expiry — all recoverable — and this one value is not
  // recoverable at all while looking identical to them. The box is what stops it being skimmed past.
  const reset = `${invocationPrefix()}clearotron passphrase --reset`;
  if (mintedPassphrase) {
    const rule = "─".repeat(66);
    say(`  ┌${rule}┐`);
    say(`  │  Open        ${envs.url}`);
    say(`  │  Sign in as  ${user}`);
    say(`  │  Passphrase  ${mintedPassphrase}`);
    say(`  │`);
    say(`  │  WRITE THE PASSPHRASE DOWN NOW. It is stored only as a digest, so`);
    say(`  │  nothing — not this product, not this terminal — can read it back.`);
    say(`  │  Lost it? ${reset}`);
    say(`  └${rule}┘`);
  } else {
    say(`  Sign in as ${user}.`);
    say("  The passphrase was minted on an earlier start and is NOT reprinted — it is stored only as a");
    say(`  digest. Lost it? Run  ${reset}  to mint a new one.`);
  }
  say("");
  if (worker) {
    say("  Ordering a clearance from the portal starts it. The portal prices the run and asks you to");
    say("  confirm before anything is spent — that confirmation is the moment money is committed.");
  } else {
    say("  Ordering a clearance from the portal puts the job in the queue and shows it there with its");
    say("  position. You started with --no-worker, so nothing is draining it: run");
    say("    node driver/runner.mjs --watch");
    say("  in another terminal when you want the queued work done.");
  }
  say("");
  // ── THE CONNECT ROUTE, SAID WHERE A FIRST-TIME READER IS LOOKING ───────────
  //
  // The owner's words after his own fresh install: "i, right now, have NO IDEA how to connect it to
  // claude and NO IDEA how to get any information for this." Everything that offered a connector was
  // built around a hosted address this install does not have, so it all rendered empty — while the
  // route that works needed one line and appeared nowhere. His follow-up was "that should be default
  // up and running no?", and this is the closing block of the command he had just run.
  //
  // The string comes from the ONE composer, not from a literal here: three surfaces state this route
  // and a line of instruction with more than one author drifts silently.
  const connect = stdioConnectOffer({ workDir: process.env.CLEAROTRON_WORK_DIR || null });
  say("  Connect your assistant to this install — one line, no address and no sign-in:");
  say("");
  say(`    ${connect.command}`);
  say("");
  say(`  Check it:  ${connect.verify}`);
  say("");
  // ── WHERE TO TYPE THE THINGS JUST PRINTED ( — F31) ───────────────────────
  //
  // This block prints commands and then HOLDS THE TERMINAL in the foreground, so not one of them can be
  // run from where the reader is sitting. `--background` was named two paragraphs on as a property —
  // "the form that survives it" — and never as the answer to "how do I run what you just told me to
  // run". Saying it here, before the commands go by, is the whole fix.
  say("  This terminal is now the product: it runs only while this command does, and Ctrl-C — or closing");
  say("  the window — stops everything it started. So the commands above need a SECOND terminal.");
  say(`  To get your prompt back instead, stop this and run  ${invoke("start")} --background`);
  say("  — same product, managed by systemd, and it survives logout.");
  say("");
}
