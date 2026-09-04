// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// doors-agree.test.mjs — THE ACCEPTANCE TEST for.
//
// Four products, FIVE doors, one answer. For every product and every illegal shape the offering names,
// this drives the PORTAL, the ops-MCP start_run, the headless CLI, the dev cockpit and the plan_run
// preview, and asserts that all five resolve the same product, store the same request, and refuse with
// the SAME REASON IN THE SAME WORDS.
//
// ── WHY THIS EXISTS ─────────────────────────────────────────────────────────────────────────────────
//
// The doors did not agree. `checkClearanceScopeRules` ran at the runner, the portal and plan_run and at
// NEITHER start_run nor the CLI. The mark budget and the availability gate ran at the runner and
// plan_run alone. The dev cockpit ran none of them and nobody had noticed it was a door. So a request
// one door refused with a sentence was accepted silently by another, queued, and refused hours later at
// admission by a different sentence — or, worse, admitted. A rule that lives at a door is a rule the
// other doors do not have.
//
// ── WHY THIS FILE IS SHAPED THE WAY IT IS, AND WHAT THE PREVIOUS SHAPE MISSED ────────────────────────
//
// The first version of this file passed green over five confirmed defects, and every one of them got
// through the same way: the file decided FOR ITSELF what the doors were and what had to be covered.
//
//   1. THE DOOR LIST IS DERIVED, NOT LISTED. `doorsFromSource()` below reads the driver and mcp-server
//      sources and collects every module that calls `validateJob(` — which is what an intake door IS.
//      Every one must be either driven here or declared a non-door WITH A REASON. The old file named
//      three doors from memory and `driver/dev-portal.mjs` — a live form that posts a job and writes the
//      queue — was not one of them. A hand-kept list cannot report what nobody remembered to add.
//
//   2. THE REFUSAL COVERAGE IS DERIVED FROM products.mjs. The case table is KEYED by REFUSAL_REASONS
//      and every expected sentence is COMPUTED by calling `checkProductScope` / `checkNativeLanguage`
//      with that case's own inputs. The old file kept a `covered` Set literal beside the cases, so a
//      ninth reason plus one line in the Set passed with no parity case at all — and it exempted
//      TERRITORY_NOT_RECOGNIZED as refusing "identically at every door by construction", which was
//      simply untrue.
//
//   3. THE ADAPTERS GO ALL THE WAY TO THE DOOR. The CLI adapter runs `enqueue.mjs` as a PROCESS,
//      because the CLI's divergent refusal lived in `main()` and the old adapter started after it. The
//      portal adapter builds the body the COMPOSER builds (`bodyFor`/`geographyFor`,
//      portal-ui/src/screens/NewClearance.tsx + contract/composerProduct.ts) rather than a shape the
//      real screen cannot produce.
//
//   4. EVERY CASE STATES ITS GEOGRAPHY INTENT. "worldwide", named territories and "the account's own"
//      are three different searches, and a case that leaves it unsaid is a case where the doors are
//      RIGHT to differ (the composer stamps worldwide for an empty list; the CLI stamps
//      account-default). `driveAll` refuses such a case rather than measuring a disagreement that is
//      not one.
//
//   5. AN ACCOUNT WITH DEFAULTS IS EXERCISED. The old file used `generic` throughout — no default
//      territories, no default product — so the account-default arm, where every asymmetry in the
//      matrix lived, was never reached. `aurora` holds seven territories and `zephyr` holds a default
//      product and a one-name budget.
//
// THE ASSERTION IS ON THE REFUSAL STRING, not on a boolean or a substring: two doors that refuse for the
// same reason in different words have given a requester two different products.
//
// Offline: no HTTP to anywhere real, no jose. The portal's trigger is injected; start_run and the dev
// cockpit write to temp queues; the CLI runs `--dry-run`, which validates and gates and writes nothing.

import { mkdtempSync as __mkdtemp } from "node:fs";
import { tmpdir as __tmpdir } from "node:os";
import { join as __join } from "node:path";
import { pinEnv, envFrom } from "../../shared/env-aliases.mjs";   // — the default is taken only when NO spelling holds a value
pinEnv(process.env, "CLEAROTRON_WORK_DIR", envFrom(process.env, "CLEAROTRON_WORK_DIR") || __mkdtemp(__join(__tmpdir(), "doors-ws-")));
pinEnv(process.env, "CLEAROTRON_REPORTS_DIR", envFrom(process.env, "CLEAROTRON_REPORTS_DIR") || __mkdtemp(__join(__tmpdir(), "doors-pool-")));
pinEnv(process.env, "CLEAROTRON_QUEUE_DIR", envFrom(process.env, "CLEAROTRON_QUEUE_DIR") || __mkdtemp(__join(__tmpdir(), "doors-queue-")));

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, writeFileSync, existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { createServer, request as httpRequest } from "node:http";
import {
  PRODUCT_IDS, PRODUCTS, REFUSAL_REASONS, productName,
  checkProductScope, checkNativeLanguage, unknownProductMessage, CASE_LAW_NOT_A_REQUEST,
  NATIVE_LANGUAGE_NOT_A_SUPPRESSION, SEARCH_LEVEL_NOT_A_REQUEST,
} from "../products.mjs";
import { RESOLVED_CHECKS } from "../scope-rules.mjs";
import { DECLARED_JOB_FIELDS, PORTAL_ROUTE_UNAVAILABLE, EXAMPLE_JOB } from "../enqueue-schema.mjs";
import { CLI_JOB_FIELDS } from "../enqueue.mjs";
import { nonEmpty } from "../../shared/vacuous-pass.mjs";
import { demoRunAgreement } from "../demo-run-agreement.mjs";   // — the WALL's own decision, computed here once
import { loadProfiles } from "../profiles.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const DRIVER = join(HERE, "..");
const REPO = join(DRIVER, "..");

const { makePortalService } = await import("../portal-service.mjs");
const { startRun } = await import("../../mcp-server/lib/ops.mjs");
const { planRun } = await import("../../mcp-server/lib/plan.mjs");
const { startPortal, DEV_COCKPIT_JOB_FIELDS } = await import("../dev-portal.mjs");
const { PORTAL_JOB_FIELDS } = await import("../portal-service.mjs");
const { START_RUN_JOB_FIELDS, buildJob } = await import("../../mcp-server/lib/ops.mjs");
// The MCP TOOL DEFINITIONS themselves — what the two faces OFFER by name. A field a schema invites is
// a field an agent will send, which is precisely what deliveryRoute was.
const { TOOL_DEFS } = await import("../../mcp-server/server.mjs");

// ── THE DOOR LIST, DERIVED FROM THE SOURCE ───────────────────────────────────────────────────────────

/**
 * Every module that calls `validateJob(` — which is the definition of an intake door: the thing that
 * takes a request, applies the shared validator and decides whether it becomes a run.
 *
 * Read off the source rather than remembered, because the ONE door this file did not know about was a
 * door for as long as nobody re-read the tree. A new door added tomorrow fails this test on the day it
 * lands, which is the only moment at which adding its adapter is cheap.
 */
function doorsFromSource() {
  const roots = [DRIVER, join(REPO, "mcp-server", "lib")];
  const hits = [];
  for (const root of roots) {
    for (const f of nonEmpty(readdirSync(root, { withFileTypes: true }), "readdirSync(root, { withFileTypes: true })")) {
      if (!f.isFile() || !f.name.endsWith(".mjs")) continue;
      const p = join(root, f.name);
      // COMMENTS STRIPPED FIRST. Half this codebase's prose says the word "validateJob (…" in passing,
      // and a scan that counted those would classify modules that never call it — an exemption list
      // padded with fiction is how a real door hides in it.
      const code = readFileSync(p, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
      if (/\bvalidateJob\s*\(/.test(code)) hits.push(relative(REPO, p));
    }
  }
  return hits.sort();
}

/** Modules that call validateJob and are NOT intake doors. A reason each — an unexplained exemption is
 *  how the dev cockpit stayed invisible. */
const NOT_A_DOOR = {
  "driver/enqueue-schema.mjs":
    "the DEFINITION site. validateJob is declared here; a module cannot be a door to itself.",
  "driver/runner.mjs":
    "THE WALL, not an intake door. It re-validates a job that was already accepted (atClaim) and either "
    + "admits it or parks it as clarify. It runs the same shared fold as the doors (checkResolvedProduct) "
    + "and its refusals are driven end-to-end, through a real claim, by runner.search-policy-gate.test.mjs.",
};
/** The wall's own parity is proved elsewhere; assert the file that proves it still exists. */
const WALL_TEST = "driver/test/runner.search-policy-gate.test.mjs";

// ── the request spec ────────────────────────────────────────────────────────────────────────────────
//
// One shape, five transports. Every case must state exactly ONE geography intent — see the header.

const GEOGRAPHY_INTENTS = ["worldwide", "jurisdictions", "accountDefault"];
function geographyIntentOf(req) {
  const stated = GEOGRAPHY_INTENTS.filter((k) => req[k] != null && req[k] !== false);
  assert.equal(stated.length, 1,
    `every parity case must state exactly ONE geography intent (${GEOGRAPHY_INTENTS.join(" | ")}) — `
    + `"worldwide", named territories and "the account's own" are three different searches, and doors are `
    + `RIGHT to differ about a request that says nothing. Got: ${JSON.stringify(stated)}`);
  return stated[0];
}

/** The stamp the door is expected to carry, from the intent. Named once so five adapters cannot each
 *  invent one. */
const stampFor = (req) => ({
  worldwide: { mode: "worldwide" },
  jurisdictions: { mode: "named" },
  accountDefault: { mode: "account-default" },
}[geographyIntentOf(req)]);

// STAFF acting for a named account. `generic` carries no default territories and no default product, so
// a case that names it measures the REQUEST alone; `aurora` (seven default territories) and `zephyr`
// (a default product and a one-name budget) are what reach the account-default arm.
const GRANTS = { tenants: { celta: { accounts: ["aurora", "zephyr", "generic"], users: { "cli@celta.example": ["aurora"] } } } };
const PRINCIPAL = { email: "staff@example-firm.com" };
const accountOf = (req) => req.profileKey ?? "generic";

/** THE PORTAL. The real route handler at the real gate. The BODY is the one the composer builds —
 *  `bodyFor` (portal-ui/src/screens/NewClearance.tsx) over `geographyFor`
 *  (portal-ui/src/contract/composerProduct.ts): the stamp is ALWAYS sent, `nativeLanguage` only when
 *  true, and `jurisdictions` only when the requester picked some. The old adapter hand-built a body
 *  with no stamp at all, which is a shape the screen cannot produce and the ladder resolves
 *  differently. `account-default` is not a stamp the composer emits — but the route accepts it, so an
 *  agent can send it, so this door has to judge it. */
async function portalDoor(req) {
  let sent = null;
  const svc = makePortalService({
    secret: "s".repeat(32),
    grants: GRANTS,
    staffDomains: ["example-firm.com"],
    trigger: async (job) => { sent = job; return { ok: true, id: job.id }; },
    audit: () => {},
  });
  const body = {
    account: accountOf(req),
    markName: req.markName ?? "NOVAPULSE",
    ...(req.marks ? { marks: req.marks } : {}),
    classes: [9],
    ...(req.product ? { product: req.product } : {}),
    ...(req.jurisdictions ? { jurisdictions: req.jurisdictions } : {}),
    ...(req.platforms ? { platforms: req.platforms } : {}),
    geography: stampFor(req),
    // VERBATIM, `false` included. The adapters used to collapse this to `true`-or-absent, which made
    // `nativeLanguage: false` a shape no parity case could express — and it was dropped at all four
    // assembling doors, uniformly, so nothing anywhere disagreed about a suppression that never was.
    ...(req.nativeLanguage != null ? { nativeLanguage: req.nativeLanguage } : {}),
    ...(req.caseLaw != null ? { caseLaw: req.caseLaw } : {}),
    // PRESENCE, not non-null: the refusal is on the key itself, so an adapter that forwarded only
    // non-null values could not express the case at all.
    ...("searchLevel" in req ? { searchLevel: req.searchLevel } : {}),
    ...(req.deliveryRoute != null ? { deliveryRoute: req.deliveryRoute } : {}),
  };
  const plan = await svc.route("POST", "/portal/api/run/plan", PRINCIPAL, body);
  if (plan.status !== 200) return { ok: false, errors: plan.json?.errors ?? [], name: null, sent: null };
  // AND THEN THE SPEND PATH, with the token the plan step minted. planGates runs again there — "the
  // token is necessary, never sufficient" — and only this hop hands the finished job to `trigger`,
  // which is the STORED REQUEST the other doors are compared against.
  const run = await svc.route("POST", "/portal/api/run", PRINCIPAL,
    { ...body, confirmationToken: plan.json.confirmationToken });
  return { ok: run.status === 200, errors: run.json?.errors ?? [], name: plan.json?.name ?? null, sent };
}

/** THE OPS-MCP WRITE DOOR. The real start_run body: buildJob, validateJob, the resolved-product gate,
 *  then the queue write. */
function mcpArgs(req) {
  return {
    markName: req.markName ?? "NOVAPULSE",
    ...(req.marks ? { marks: req.marks } : {}),
    classes: [9],
    forwarder: "jordan",
    id: `doors-mcp-${Math.random().toString(36).slice(2, 10)}`,
    ...(req.profileKey ? { profileKey: req.profileKey } : {}),
    ...(req.product ? { product: req.product } : {}),
    ...(req.jurisdictions ? { jurisdictions: req.jurisdictions } : {}),
    ...(req.platforms ? { platforms: req.platforms } : {}),
    ...(req.worldwide ? { worldwide: true } : {}),
    ...(req.nativeLanguage != null ? { nativeLanguage: req.nativeLanguage } : {}),
    ...(req.caseLaw != null ? { caseLaw: req.caseLaw } : {}),
    // PRESENCE, not non-null: the refusal is on the key itself, so an adapter that forwarded only
    // non-null values could not express the case at all.
    ...("searchLevel" in req ? { searchLevel: req.searchLevel } : {}),
    ...(req.deliveryRoute != null ? { deliveryRoute: req.deliveryRoute } : {}),
  };
}
function mcpDoor(req) {
  try {
    const r = startRun(mcpArgs(req), { scope: {} });
    return { ok: true, errors: [], queued: r.queuePath };
  } catch (e) {
    // The refusals as DATA. The thrown message glues them with "; ", which occurs inside the sentences
    // themselves, so splitting the string back apart produces fragments that match nothing.
    return { ok: false, errors: e.errors ?? [String(e.message)] };
  }
}

/** THE OPS-MCP PREVIEW. plan_run spends nothing, and its whole contract is that it describes the job
 *  start_run would build — so a blocker it does not raise is a run somebody will be told to start and
 *  then watch park. */
function planDoor(req) {
  const p = planRun(mcpArgs(req), { scope: {} });
  return { ok: p.blockers.length === 0, errors: p.blockers, name: p.search?.name ?? null };
}

/** THE CLI — the WHOLE of `enqueue.mjs main()`, run as a process.
 *
 *  The old adapter called `assembleFromFlags` + `validateJob`, which is what main() runs AFTER the check
 *  that differed: main() refused an unknown `--product` in its own words, before validateJob, and the
 *  test could not see it. `--dry-run` validates, gates, and writes nothing. */
const CLI = join(DRIVER, "enqueue.mjs");
function cliDoor(req) {
  const argv = [
    "--mark", req.markName ?? "NOVAPULSE",
    "--classes", "9",
    "--forwarder", "jordan",
    "--dry-run",
    ...(req.profileKey ? ["--profile", req.profileKey] : []),
    ...(req.product ? ["--product", req.product] : []),
    ...(req.jurisdictions ? ["--jurisdictions", req.jurisdictions.join(",")] : []),
    ...(req.platforms ? ["--platforms", req.platforms.join(",")] : []),
    ...(req.worldwide ? ["--worldwide"] : []),
    ...(req.nativeLanguage === true ? ["--native-language"] : []),
    ...(req.deliveryRoute != null ? ["--delivery-route", String(req.deliveryRoute)] : []),
    ...(req.marks ? ["--marks", req.marks.map((m) => m.name ?? m).join("\n")] : []),
  ];
  // Two shapes this door's FLAGS cannot state, both carried by a `--job` file — which is the point of
  // the cases that use them. `caseLaw` has no flag because it is not a request setting; `--native-
  // language` is a boolean flag and can only ever say true, so an explicit `false` reaches the assembler
  // through the job base. Both must be refused here in the same words as at the other four doors.
  const base = {};
  if (req.caseLaw != null) base.caseLaw = req.caseLaw;
  if ("searchLevel" in req) base.searchLevel = req.searchLevel;   // presence, not non-null
  if (req.nativeLanguage === false) base.nativeLanguage = false;
  if (Object.keys(base).length) {
    const f = join(mkdtempSync(join(tmpdir(), "doors-cli-")), "job.json");
    writeFileSync(f, JSON.stringify(base));
    argv.unshift("--job", f);
  }
  const r = spawnSync(process.execPath, [CLI, ...argv], { encoding: "utf8" });
  let out = {};
  try { out = JSON.parse(r.stdout); } catch { /* a crash prints nothing parseable — surfaced below */ }
  return {
    ok: r.status === 0 && out.ok === true,
    errors: out.errors ?? (r.status === 0 ? [] : [String(r.stderr || "").trim()]),
    job: out.job ?? null,
    stderr: r.stderr,
  };
}

/** THE DEV COCKPIT — the fourth door, and the one nobody had counted. `/dev/enqueue` calls validateJob
 *  and writes the queue, which is what a door is. */
let devServer = null, devQueue = null;
async function devPortal() {
  if (devServer) return devServer;
  devQueue = mkdtempSync(join(tmpdir(), "doors-devq-"));
  devServer = await startPortal({ poolRoot: mkdtempSync(join(tmpdir(), "doors-devpool-")), port: 0, queueDir: devQueue });
  return devServer;
}
after(() => { if (devServer) devServer.close(); });
function devPost(port, body) {
  return new Promise((resolveP, rejectP) => {
    const payload = JSON.stringify(body);
    const r = httpRequest({ host: "127.0.0.1", port, path: "/dev/enqueue", method: "POST",
      headers: { "content-type": "application/json", "content-length": Buffer.byteLength(payload) } }, (res) => {
      let data = ""; res.on("data", (c) => { data += c; }); res.on("end", () => {
        let json = {}; try { json = JSON.parse(data); } catch { /* surfaced by the caller */ }
        resolveP({ status: res.statusCode, json });
      });
    });
    r.on("error", rejectP); r.write(payload); r.end();
  });
}
async function devDoor(req) {
  const srv = await devPortal();
  const body = {
    mark: req.markName ?? "NOVAPULSE",
    classes: "9",
    forwarder: "dev",
    ...(req.profileKey ? { profile: req.profileKey } : {}),
    ...(req.product ? { product: req.product } : {}),
    ...(req.jurisdictions ? { jurisdictions: req.jurisdictions.join(",") } : {}),
    ...(req.platforms ? { platforms: req.platforms.join(",") } : {}),
    ...(req.worldwide ? { worldwide: true } : {}),
    ...(req.nativeLanguage != null ? { nativeLanguage: req.nativeLanguage } : {}),
    ...(req.caseLaw != null ? { caseLaw: req.caseLaw } : {}),
    // PRESENCE, not non-null: the refusal is on the key itself, so an adapter that forwarded only
    // non-null values could not express the case at all.
    ...("searchLevel" in req ? { searchLevel: req.searchLevel } : {}),
    ...(req.deliveryRoute != null ? { deliveryRoute: req.deliveryRoute } : {}),
    ...(req.marks ? { marks: req.marks.map((m) => m.name ?? m).join("\n") } : {}),
  };
  const r = await devPost(srv.address().port, body);
  return { ok: r.status === 200 && r.json.ok === true, errors: r.json.errors ?? [], id: r.json.id ?? null };
}

/** name → [source module, adapter]. The source path is what the derivation above joins against. */
const DOOR_ADAPTERS = {
  portal: ["driver/portal-service.mjs", portalDoor],
  start_run: ["mcp-server/lib/ops.mjs", mcpDoor],
  plan_run: ["mcp-server/lib/plan.mjs", planDoor],
  cli: ["driver/enqueue.mjs", cliDoor],
  dev_cockpit: ["driver/dev-portal.mjs", devDoor],
};
const DOORS = Object.entries(DOOR_ADAPTERS).map(([name, [, fn]]) => [name, fn]);

/** Drive every door, and return what each said. */
async function driveAll(req) {
  geographyIntentOf(req);   // a case with no stated geography is not a parity case — refuse it loudly
  const out = {};
  for (const [name, door] of DOORS) out[name] = await door(req);
  return out;
}

function assertAllRefuse(label, said, refusal) {
  for (const [door] of DOORS) {
    const r = said[door];
    assert.equal(r.ok, false, `${label}: ${door} ACCEPTED a request the offering forbids`);
    assert.ok(
      r.errors.some((e) => e === refusal),
      `${label}: ${door} refused with a DIFFERENT sentence.\n  expected: ${refusal}\n  got:      ${JSON.stringify(r.errors, null, 2)}`,
    );
  }
}

/**
 * THE WALL'S OWN VERDICT for this request, from the predicate `claimAndPrep` calls —.
 *
 * Every profile this file uses as a fixture except `generic` carries `demoData: true`, because those are
 * the only accounts with the defaults these cases need (aurora's seven territories, zephyr's default
 * product). That was invisible while no door asked the wall's question. `--dry-run` now asks it, so a
 * fixture that could never run anywhere started reading as a door refusing a legal request.
 */
function wallVerdictFor(req) {
  if (!req?.profileKey) return null;
  let profile = null;
  try { profile = loadProfiles().get(String(req.profileKey)) ?? null; } catch { return null; }
  if (!profile) return null;
  return demoRunAgreement({
    demoRun: req.demoRun === true,
    demoData: profile.demoData === true,
    who: req.account ?? req.profileKey ?? "this account",
  });
}

/**
 * TWO QUESTIONS, SPLIT —, and the split is what keeps this arm's teeth.
 *
 * PRODUCT PARITY keeps its full force: a door refusing for any reason of its own still fails, exactly as
 * before. Nothing here is exempted.
 *
 * WALL FIDELITY is the new half. A door that consults the wall must quote it EXACTLY — same sentence,
 * from the same predicate — so a door cannot invent its own wording for the wall's decision, and cannot
 * drift from it later. That is a property nothing asserted before this issue.
 *
 * WHAT THIS DELIBERATELY DOES NOT ASSERT, and the reason is measured rather than assumed: "every door
 * returns the same wall refusal" is FALSE today and this change is what makes it so. Only `enqueue.mjs`
 * (--dry-run) and `runner.mjs` (the wall itself) call `demoRunAgreement`; the portal, the cockpit and
 * start_run do not, so for one demo request the CLI refuses and the others admit. Asserting uniformity
 * would red on the day it was written, and the fix for that red would be to relocate the wall to every
 * door — which 's own Out-of-scope forbids in as many words. So this asserts the strongest
 * property that is TRUE: a door that answers the wall's question answers it in the wall's words. When
 * another door gains the consultation, it is covered by this the same day, with no edit here.
 */
function assertAllAccept(label, said, req = null) {
  const wall = wallVerdictFor(req);
  for (const [door] of DOORS) {
    const r = said[door];
    const errs = r.errors ?? [];
    if (wall && !wall.ok && !r.ok) {
      // WALL FIDELITY. The door refused and the wall would refuse this account too, so the door must be
      // quoting the wall — EXACTLY, and nothing else beside it. Deliberately `deepEqual` against the
      // wall's own sentence rather than "contains it": a door that bolted its own wording onto the
      // wall's, or refused for a product reason as well, is a divergence this arm exists to catch.
      assert.deepEqual(errs, [wall.reject],
        `${label}: ${door} refused, and the wall refuses this account — but not in the wall's words`);
      continue;
    }
    // PRODUCT PARITY, unchanged and unexempted: any other refusal of a legal request still fails.
    assert.equal(r.ok, true, `${label}: ${door} refused a legal request — ${JSON.stringify(errs)}`);
  }
}

// ── every refusal the offering can produce, KEYED BY REASON, with its sentence COMPUTED ─────────────
//
// The key set of this table is asserted equal to `Object.values(REFUSAL_REASONS)` at the foot of the
// file. Adding a ninth reason therefore fails until it has a parity case — the old completeness check
// compared the reasons against a Set literal in the same test, which any new reason could join in one
// line without ever being driven through a door.
//
// `message` is a FUNCTION that calls products.mjs with this case's own inputs. Typing the sentence here
// would pass when the sentence changed at one door and not another, which is what this file exists to
// catch.
const scopeMsg = (product, territories) => checkProductScope({ product, territories }).message;
const nativeMsg = (product) => checkNativeLanguage({ product }).message;

const REFUSAL_CASES = {
  [REFUSAL_REASONS.NARROWING_NOT_OFFERED]: {
    label: "a narrowed Global preliminary search",
    req: { product: "global-preliminary-search", jurisdictions: ["United States", "France"] },
    message: () => scopeMsg("global-preliminary-search", ["United States", "France"]),
  },
  [REFUSAL_REASONS.TOO_MANY_COUNTRIES]: {
    label: "a two-country Full country search",
    req: { product: "full-country-search", jurisdictions: ["United States", "France"] },
    message: () => scopeMsg("full-country-search", ["United States", "France"]),
  },
  [REFUSAL_REASONS.REGION_NOT_A_COUNTRY]: {
    label: "a REGION at a Full country search",
    req: { product: "full-country-search", jurisdictions: ["European Union"] },
    message: () => scopeMsg("full-country-search", ["European Union"]),
  },
  [REFUSAL_REASONS.WORLDWIDE_NOT_OFFERED]: {
    label: "a worldwide Multi-country focus search",
    req: { product: "multi-country-focus-search", worldwide: true },
    message: () => scopeMsg("multi-country-focus-search", []),
  },
  [REFUSAL_REASONS.NOT_ENOUGH_COUNTRIES]: {
    label: "a one-country Multi-country focus search",
    req: { product: "multi-country-focus-search", jurisdictions: ["France"] },
    message: () => scopeMsg("multi-country-focus-search", ["France"]),
  },
  [REFUSAL_REASONS.NATIVE_LANGUAGE_NOT_OFFERED]: {
    label: "the native-language investigation at a knockout",
    req: { product: "knockout-search", nativeLanguage: true, worldwide: true },
    message: () => nativeMsg("knockout-search"),
  },
  [REFUSAL_REASONS.CASE_LAW_NOT_OFFERED]: {
    label: "caseLaw as a request setting",
    req: { product: "full-country-search", jurisdictions: ["United States"], caseLaw: true },
    message: () => CASE_LAW_NOT_A_REQUEST.message,
  },
  // The SIBLING TOGGLE, and the same doctrine gap one field over. `nativeLanguage: false` was dropped at
  // all four assembling doors — uniformly, so it broke no parity — while `caseLaw: false` was refused at
  // all five in products.mjs's own words. The MCP schema declares nativeLanguage a plain boolean, so
  // `false` is a shape an agent WILL send, and on a Full country search it reads as "and don't run the
  // native-language investigation" over a search that runs it by being one.
  [REFUSAL_REASONS.NATIVE_LANGUAGE_NOT_A_SUPPRESSION]: {
    label: "nativeLanguage: false, a suppression on a toggle that only ever added",
    req: { product: "full-country-search", jurisdictions: ["United States"], nativeLanguage: false },
    message: () => NATIVE_LANGUAGE_NOT_A_SUPPRESSION.message,
  },
  // NOT EXEMPT ANY MORE. The old file declared this one covered "by construction", on the grounds that
  // it is not a product-vs-geography disagreement — and a probe showed validateJob returning zero errors
  // for `{jurisdictions:["Freedonia"]}` at every door, because with no product NAMED nothing judged the
  // scope at all. The resolved product is never null, and the unrecognized branch fires first in
  // checkProductScope, so this now refuses at every door for real.
  [REFUSAL_REASONS.TERRITORY_NOT_RECOGNIZED]: {
    label: "a territory that names nowhere, with no product spelled out",
    req: { jurisdictions: ["Freedonia"] },
    message: () => scopeMsg("multi-country-focus-search", ["Freedonia"]),
  },
  // THE SELECTOR ITSELF — the one deleted and nothing refused. `caseLaw` and `nativeLanguage:false`
  // above were ADDITIONS somebody believed they had bought; this was HOW THE SEARCH WAS CHOSEN. Nothing
  // on any door read it, nothing refused it, and there is no generic unknown-field rejection — so a
  // caller sending `searchLevel: "knockout"` with a one-country scope was quietly given a Full country
  // search: the most expensive product, on a request that asked for the cheapest.
  //
  // The request below names a legal product and a legal scope, so ONLY the searchLevel arm can refuse
  // it — which is what makes it a parity case rather than a scope case wearing one's clothes.
  [REFUSAL_REASONS.SEARCH_LEVEL_RETIRED]: {
    label: "searchLevel, the retired depth selector, on an otherwise perfectly legal request",
    req: { product: "knockout-search", worldwide: true, searchLevel: "prelim-jx" },
    message: () => SEARCH_LEVEL_NOT_A_REQUEST.message,
  },
};

// ── the checks that only exist once the product is RESOLVED, one case each ──────────────────────────
//
// Keyed by scope-rules.mjs RESOLVED_CHECKS, and the key set is asserted equal to it. These are the rows
// of the asymmetry matrix: each one is a rule that ran at some doors and not others, so each needs a
// request that ONLY that rule refuses, driven at all five.
const RESOLVED_CASES = {
  // zephyr's defaultProduct is a Multi-country focus search, which reads ONE name. Nothing in the
  // request says so — only the account does — which is why the door could not see it and the wall could.
  "mark-budget": {
    label: "two names under an account whose default product reads one",
    req: { profileKey: "zephyr", accountDefault: true, markName: "NOVAPULSE", marks: [{ name: "NOVAPULSE" }, { name: "PULSEWAVE" }] },
    message: () => "2 names exceeds the 1-name limit for a Multi-country focus search — a clearance reads "
      + "one name at a time; send one search per name, or order a Knockout search to screen them together",
  },
  // A knockout has no marketplace grid for a named store to be swept in.
  //
  // THIS ROW IS HONEST ABOUT WHAT IT PROVES, unlike the two either side of it. Both of those are refused
  // ONLY by the fold — nothing in the request states the product, so no door could judge them without
  // resolving. This one names the product, so validateJob's own `if (orderedProduct)` branch already
  // catches it at every door, and the case would still pass if checkScopeAgainstPolicy were removed from
  // the fold. It is here because the SENTENCE has to match at every door either way; the fold's own arm
  // is reachable only from an account whose defaultProduct is a knockout, and the synthetic roster has
  // none. Stated rather than left implied: a comment claiming a property the case does not have is the
  // failure mode of the file this one replaced.
  "scope-fit": {
    label: "marketplaces named against a knockout, which has no grid to sweep them in",
    req: { product: "knockout-search", worldwide: true, platforms: ["gnc.com"] },
    message: () => "a Knockout search screen has no marketplace grid to add platforms to — its sweep is one "
      + "broad question per mark, not a per-store grid. Drop platforms to run the quick screen, or ask for a "
      + "preliminary search, whose common-law grid sweeps the account's marketplaces plus any named here",
  },
  // aurora holds SEVEN default territories. A Full country search over them is seven shallow reads sold
  // as one deep one — and the request itself names no territory at all, so this is invisible at the door.
  "scope-rules": {
    label: "a Full country search over an account's seven default territories",
    req: { product: "full-country-search", profileKey: "aurora", accountDefault: true },
    message: () => scopeMsg("full-country-search", ["NZ", "PH", "IN", "RU", "ID", "ZA", "TR"]),
  },
};

// ── the tests ───────────────────────────────────────────────────────────────────────────────────────

test("the door list is DERIVED from the source: every validateJob caller is driven here or declared", () => {
  const found = doorsFromSource();
  const driven = new Set(Object.values(DOOR_ADAPTERS).map(([src]) => src));
  const unclassified = found.filter((f) => !driven.has(f) && !NOT_A_DOOR[f]);
  assert.deepEqual(unclassified, [],
    "these modules call validateJob and are neither driven as a door nor declared a non-door with a "
    + "reason. Whatever they are, they decide whether a request becomes a run, and this file cannot "
    + "claim the doors agree while it has never asked them.");
  // …and nothing is claimed that is not there: an adapter for a module that no longer validates
  // anything is a door this file only thinks it is testing.
  for (const src of driven) assert.ok(found.includes(src), `${src} is driven as a door but no longer calls validateJob`);
  for (const src of Object.keys(NOT_A_DOOR)) assert.ok(found.includes(src), `${src} is declared a non-door but no longer calls validateJob — drop the entry`);
  assert.ok(existsSync(join(REPO, WALL_TEST)), `${WALL_TEST} is what proves the WALL agrees; NOT_A_DOOR points at it`);
});

test("every product in the offering is orderable at every door, with the geography it accepts", async () => {
  const legal = [
    ["Knockout search, worldwide", { product: "knockout-search", worldwide: true }],
    ["Knockout search, a chosen set", { product: "knockout-search", jurisdictions: ["United States", "France"] }],
    ["Global preliminary search", { product: "global-preliminary-search", worldwide: true }],
    ["Multi-country focus, a region", { product: "multi-country-focus-search", jurisdictions: ["European Union"] }],
    ["Multi-country focus, two countries", { product: "multi-country-focus-search", jurisdictions: ["France", "Germany"] }],
    ["Multi-country focus, native language", { product: "multi-country-focus-search", jurisdictions: ["China", "Japan"], nativeLanguage: true }],
    ["Full country search", { product: "full-country-search", jurisdictions: ["United States"] }],
    // THE ACCOUNT-DEFAULT ARM, which no case reached before. aurora's seven territories make a request
    // that names nothing a Multi-country focus search, and every door must admit it as one.
    ["the account's own territories, no product named", { profileKey: "aurora", accountDefault: true }],
    // zephyr's own defaultProduct, with a scope that fits it.
    ["the account's default product", { profileKey: "zephyr", accountDefault: true }],
  ];
  for (const [label, req] of legal) assertAllAccept(label, await driveAll(req), req);
});

test("every refusal the offering can produce is refused in the SAME WORDS at every door", async () => {
  for (const [reason, c] of Object.entries(REFUSAL_CASES)) {
    const said = await driveAll(c.req);
    assertAllRefuse(`${reason}: ${c.label}`, said, c.message());
  }
});

test("caseLaw is refused for FALSE as well — it never suppressed anything", async () => {
  for (const value of [true, false]) {
    const said = await driveAll({ product: "full-country-search", jurisdictions: ["United States"], caseLaw: value });
    assertAllRefuse(`caseLaw: ${value}`, said, CASE_LAW_NOT_A_REQUEST.message);
  }
});

test("a product nobody offers is refused by name, with the offering enumerated and the remedy clause, at every door", async () => {
  const said = await driveAll({ product: "prelim", worldwide: true });
  // ONE sentence, from products.mjs. The CLI used to answer with its own — `--product "prelim" names no
  // search we offer …` — fired before validateJob and missing `(or omit it for the account's default)`,
  // the single clause that tells a requester the field is optional. resolveSearchPolicy carried a third
  // variant, which is what the runner and the previews quoted.
  assertAllRefuse("a retired level key as a product", said, unknownProductMessage("prelim"));
  assert.match(unknownProductMessage("prelim"), /\(or omit it for the account's default\)$/);
});

test("more names than the product reads is refused in the same words — and SURFACED, never truncated", async () => {
  const nine = Array.from({ length: 9 }, (_, i) => ({ name: `NOVA${i}` }));
  const said = await driveAll({ product: "knockout-search", worldwide: true, markName: "NOVA0", marks: nine });
  assertAllRefuse("nine names on a Knockout search", said,
    "9 names exceeds the 8-name limit for a Knockout search — split the request");
  // NOT TRUNCATED. The whole reason the limit is a refusal is that the alternative — quietly reading the
  // first eight — delivers a report about a different request from the one that was made.
  const two = [{ name: "NOVA" }, { name: "PULSE" }];
  const clearance = await driveAll({ product: "global-preliminary-search", worldwide: true, markName: "NOVA", marks: two });
  assertAllRefuse("two names on a clearance", clearance,
    "2 names exceeds the 1-name limit for a Global preliminary search — a clearance reads one name at a time; "
    + "send one search per name, or order a Knockout search to screen them together");
});

test("the native-language toggle is judged on the RESOLVED product, not only on a named one", async () => {
  // THE ACCEPT-AND-DROP BLOCKER. `nativeLanguage: true` was judged only when the request NAMED a
  // product: omit it and the toggle was accepted, priced as nothing, and dropped — the resolver reported
  // nativeRequested:true with jxLanes:false, and the routing rule, gated on the component, stayed
  // silent. products.mjs:293 states the doctrine this broke, about caseLaw, in as many words.
  const said = await driveAll({ worldwide: true, nativeLanguage: true });
  assertAllRefuse("native language with no product named (resolves worldwide)", said,
    checkNativeLanguage({ product: "global-preliminary-search" }).message);
  // …and through the ACCOUNT RUNG, where the ladder walks past the request, finds the account holds no
  // default territories either, and resolves to the same worldwide product. The request itself states no
  // geography and no product at all — there is nothing at the door to judge, which is the whole point.
  const viaAccount = await driveAll({ profileKey: "generic", accountDefault: true, nativeLanguage: true });
  assertAllRefuse("native language on an account-resolved Global preliminary search", viaAccount,
    checkNativeLanguage({ product: "global-preliminary-search" }).message);
});

test("a native-language investigation whose scope routes no lane is refused at every door", async () => {
  // It used to refuse at the portal, plan_run and the runner, and to be accepted silently by start_run
  // and the CLI — so the same request was queued by one door and parked hours later by another.
  const said = await driveAll({ product: "multi-country-focus-search", jurisdictions: ["France", "Germany"], nativeLanguage: true });
  for (const [door] of DOORS) {
    assert.equal(said[door].ok, false, `${door} accepted a deepening with nothing to route`);
    assert.ok(said[door].errors.some((e) => /native-script deepening routes on territory/.test(e)
      && /scope \("France", "Germany"\)/.test(e)),
    `${door}: ${JSON.stringify(said[door].errors)}`);
  }
});

test("every check that needs the RESOLVED product runs at every door, and refuses in the same words", async () => {
  for (const [check, c] of Object.entries(RESOLVED_CASES)) {
    const said = await driveAll(c.req);
    assertAllRefuse(`${check}: ${c.label}`, said, c.message());
  }
});

// ── the STORED REQUEST is identical, whichever door wrote it ─────────────────────────────────────────

test("the same request stores the same job at every writing door — geography stamp included", async () => {
  const cases = [
    ["worldwide", { product: "global-preliminary-search", worldwide: true }],
    ["named", { product: "multi-country-focus-search", jurisdictions: ["France", "Germany"] }],
    ["one country", { product: "full-country-search", jurisdictions: ["United States"] }],
    ["the account's own", { profileKey: "aurora", accountDefault: true }],
  ];
  for (const [label, req] of cases) {
    const said = await driveAll(req);
    // The fields that describe WHAT WAS ORDERED. Identity fields (id, msgId, forwarder, timestamps) are
    // legitimately per-door and are not compared; everything a run's behaviour depends on is.
    const shape = (job) => ({
      product: job.product ?? null,
      jurisdictions: job.jurisdictions ?? null,
      geography: job.geography ? { mode: job.geography.mode, origin: job.geography.origin } : null,
      nativeLanguage: job.nativeLanguage ?? null,
      caseLaw: job.caseLaw ?? null,
    });
    const portal = shape(said.portal.sent ?? {});
    assert.deepEqual(shape(said.cli.job ?? {}), portal, `${label}: the CLI and the portal stored different requests`);
    const mcp = shape(JSON.parse(readFileSync(said.start_run.queued, "utf8")));
    assert.deepEqual(mcp, portal, `${label}: start_run and the portal stored different requests`);
    const dev = shape(JSON.parse(readFileSync(join(devQueue, `${said.dev_cockpit.id}.json`), "utf8")));
    assert.deepEqual(dev, portal, `${label}: the dev cockpit and the portal stored different requests`);
    // EVERY case states its geography intent, and the stamp the doors wrote has to be that intent.
    assert.equal(portal.geography?.mode, stampFor(req).mode, `${label}: the stored stamp is not the stated intent`);
  }
});

// ── the RESOLVED PRODUCT is identical, whichever door asked ──────────────────────────────────────────

test("every door resolves and NAMES the same product for the same request", async () => {
  const { resolveRequest, productOfRun } = await import("../resolve-request.mjs");
  for (const spec of PRODUCTS) {
    const req = spec.id === "global-preliminary-search" || spec.id === "knockout-search"
      ? { product: spec.id, worldwide: true }
      : spec.id === "full-country-search"
        ? { product: spec.id, jurisdictions: ["United States"] }
        : { product: spec.id, jurisdictions: ["France", "Germany"] };
    const said = await driveAll(req);
    // Both MCP-facing surfaces state the product's NAME — that is what a client reads.
    assert.equal(said.portal.name, spec.name, `${spec.id}: the portal named it "${said.portal.name}"`);
    assert.equal(said.plan_run.name, spec.name, `${spec.id}: plan_run named it "${said.plan_run.name}"`);
    // And the resolution the runner's wall performs agrees, from the stored job alone.
    const { resolved, scope } = resolveRequest(said.cli.job, { profile: null, recipes: null });
    assert.equal(resolved.product, spec.id, `${spec.id}: the wall resolved ${resolved.product}`);
    assert.equal(productOfRun({ resolved, scope }), spec.id,
      `${spec.id}: the product DERIVED from what will run disagrees with the product that was ordered`);
  }
});

// ── the coverage of THIS FILE is derived, not declared ───────────────────────────────────────────────

test("the parity cases cover every refusal reason and every resolved-product check, by DERIVATION", () => {
  // Not a Set literal maintained beside the cases — the key sets of the two tables above ARE the claim,
  // and they are compared against the modules that own them. A ninth refusal reason, or a fourth
  // resolved check, fails here on the commit that adds it.
  assert.deepEqual(Object.keys(REFUSAL_CASES).sort(), Object.values(REFUSAL_REASONS).sort(),
    "every reason products.mjs can produce needs a parity case, and every case needs a real reason");
  assert.deepEqual(Object.keys(RESOLVED_CASES).sort(), [...RESOLVED_CHECKS].sort(),
    "every check scope-rules.mjs folds needs a request that ONLY it refuses, driven at every door");
  assert.equal(PRODUCT_IDS.length, 4, "the offering has four products; a fifth needs its own parity cases");
  assert.equal(DOORS.length, 5, "five doors; a sixth is caught by the derivation test above, then needs an adapter");
  // The expected sentences are COMPUTED, never typed: assert that each case's message function actually
  // reaches products.mjs rather than returning a literal somebody pasted.
  for (const [reason, c] of Object.entries(REFUSAL_CASES)) {
    assert.equal(typeof c.message(), "string", `${reason} produced no sentence`);
    assert.ok(c.message().length > 20, `${reason}'s sentence is too short to be one of ours`);
  }
  assert.ok(productName("full-country-search"), "the offering still names its products");
});

// ── deliveryRoute: THE FIELD TWO DOORS ACCEPTED AND DROPPED ──────────────────────────────────────────

test("deliveryRoute \"portal\" is refused in the SAME WORDS at every door — never accepted and dropped", async () => {
  // MEASURED END TO END, not inferred. The portal and the dev cockpit assembled their jobs from a field
  // allow-list that did not name `deliveryRoute`, so the field was gone before validateJob or the door
  // gates could see it: /plan 200, /run 200, `trigger` handed a job carrying no deliveryRoute key at all,
  // and the run went out BY EMAIL. The guarantee that broke: a portal request must never silently go out
  // by email. This is that sentence as a test.
  const said = await driveAll({ product: "global-preliminary-search", worldwide: true, deliveryRoute: "portal" });
  assertAllRefuse("deliveryRoute \"portal\"", said, PORTAL_ROUTE_UNAVAILABLE);
  // AND THE JOB NEVER REACHED THE COURIER. A refusal at /plan alone would still leave the run door
  // reachable with a token minted for a body that named no route; the portal adapter drives BOTH hops and
  // only the second calls `trigger`, so a null here is the delivery that did not happen.
  assert.equal(said.portal.sent, null, "the portal handed a portal-route job to the courier anyway");
});

test("deliveryRoute \"email\" is ACCEPTED at every door, and stored — the refusal is the lane, not the field", async () => {
  // The other half, and it is not decoration: a fix that refused the FIELD rather than the unbuilt VALUE
  // would pass the test above and quietly break the default every existing job relies on.
  const req = { product: "global-preliminary-search", worldwide: true, deliveryRoute: "email" };
  const said = await driveAll(req);
  assertAllAccept("deliveryRoute \"email\"", said);
  assert.equal(said.portal.sent?.deliveryRoute, "email", "the portal dropped a route it accepted");
  assert.equal(said.cli.job?.deliveryRoute, "email", "the CLI dropped a route it accepted");
  assert.equal(JSON.parse(readFileSync(said.start_run.queued, "utf8")).deliveryRoute, "email");
  assert.equal(JSON.parse(readFileSync(join(devQueue, `${said.dev_cockpit.id}.json`), "utf8")).deliveryRoute, "email",
    "the dev cockpit dropped a route it accepted");
});

test("nativeLanguage is refused for FALSE at every door, and TRUE still buys the investigation", async () => {
  // The false arm rides REFUSAL_CASES above. This is the pair that proves the refusal did not swallow the
  // toggle: the one product that offers it must still take `true`.
  const bought = await driveAll({ product: "multi-country-focus-search", jurisdictions: ["China", "Japan"], nativeLanguage: true });
  assertAllAccept("nativeLanguage: true on the product that offers it", bought);
  assert.equal(bought.portal.sent?.nativeLanguage, true);
  assert.equal(bought.cli.job?.nativeLanguage, true);
});

// ── THE ALLOW-LISTS ARE A TOTAL PARTITION OF THE DECLARED FIELDS ─────────────────────────────────────

test("every door accounts for every DECLARED job field — carried, or not carried WITH A REASON", () => {
  // THIS IS THE MECHANISM FIX, and it is why the round's carrying defect cannot recur silently.
  //
  // Each assembling door builds its job by naming the fields it copies. That is an allow-list, and an
  // allow-list drops what it does not name WITHOUT SAYING SO — which is how `deliveryRoute`, a declared
  // field with its own refusal sentence, reached a delivered email through two doors that returned 200.
  //
  // Runtime refusal of every non-carried field was the rejected alternative: the doors' WIRE vocabularies
  // legitimately differ (the cockpit posts `mark`, the CLI takes `--worldwide` where the job carries
  // `geography`), so one generic sentence would name the wrong remedy at three of five doors. The claim
  // that has to hold is TOTALITY — every declared field is somebody's decision at every door — and that
  // is checkable here, on the commit that declares the next field, which is the only cheap moment.
  const declared = [...DECLARED_JOB_FIELDS].sort();
  const partitions = {
    portal: PORTAL_JOB_FIELDS,
    start_run: START_RUN_JOB_FIELDS,   // plan_run reads the same builder
    cli: CLI_JOB_FIELDS,
    dev_cockpit: DEV_COCKPIT_JOB_FIELDS,
  };
  for (const [door, part] of Object.entries(partitions)) {
    const carried = [...part.carries];
    const skipped = Object.keys(part.notCarried);
    const both = carried.filter((f) => skipped.includes(f));
    assert.deepEqual(both, [], `${door}: ${both.join(", ")} is declared BOTH carried and not carried — one field, one answer`);
    assert.deepEqual([...carried, ...skipped].sort(), declared,
      `${door}: its field partition is not the declared set. Missing fields are the silent-drop shape this `
      + `test exists to end — add each to \`carries\` if the door carries it, or to \`notCarried\` with the `
      + `reason it does not. Extra names are fields this door claims to handle and the schema does not declare.`);
    // A REASON, not a placeholder. "n/a" in this map is the exemption list padded with fiction that let
    // the dev cockpit stay invisible as a door for as long as nobody re-read it.
    for (const [f, why] of Object.entries(part.notCarried))
      assert.ok(typeof why === "string" && why.length > 30, `${door}: ${f} is skipped with no real reason ("${why}")`);
  }
  // The CLI is the door that CANNOT drop — `--job` is parsed as the job and the flags overlay on top —
  // so its partition is total by construction. Asserted rather than assumed: the day somebody adds a
  // field filter there, this is what says so.
  assert.deepEqual([...CLI_JOB_FIELDS.carries].sort(), declared, "the CLI claims to carry everything; it must");
  assert.deepEqual(Object.keys(CLI_JOB_FIELDS.notCarried), [], "the CLI has no allow-list to leave a field out of");
});

// ── THE HALF THE TEST ABOVE CANNOT SEE ──────────────────────────────────────────
//
// The assertion above compares `carries ∪ notCarried` against `DECLARED_JOB_FIELDS`: a DECLARATION
// against a DECLARATION. Both halves can be perfectly consistent while the builder reads neither.
//
// That is not hypothetical. `demoRun` was added to `START_RUN_JOB_FIELDS.carries` when it was declared,
// and `buildJob` — an allow-list — never read it. The field appeared in the mcp-server tree exactly
// once, in the declaration. So every operator door advertised that it carried the flag and none could
// deliver it: `start_run` on a `demoData` account was refused by `demoRunAgreement` with "cannot run a
// real clearance", and the one account that exists to be demonstrated was the one account no door could
// start. Measured live on 2026-09-02, on a run the requester was watching. The suite stayed green
// throughout, because nothing here ever asked the builder a question.
//
// So this arm asks it. It is BEHAVIOURAL, not a source scan: it hands buildJob a probe value for every
// field the door claims to carry and reads back what actually lands on the job. A regex over ops.mjs
// would have its own blind spots (a field read through a spread, a rename, a conditional) and would be
// measuring the text rather than the door.
//
// EVERY CARRIED FIELD NEEDS A PROBE, and a field with none FAILS rather than being skipped — otherwise
// the next undeclared-probe field is silently unmeasured, which is this defect wearing a different hat.
const PROBE = Object.freeze({
  // the two the builder refuses to run without
  markName: "PROBEMARK", forwarder: "probe-forwarder",
  // plain passthroughs
  msgId: "<probe@enqueue.local>", conversationId: "probe-conv", forwarderEmail: "probe@example.com",
  forwarderDomain: "example.com", provider: "probe-provider", ref: "PROBE-REF", classes: [9],
  product: "prelim-search", recipeKey: "probe-recipe", deliveryRoute: "email", parentRunId: "probe-parent",
  customer: "Probe Customer", profileKey: "generic", projectKey: "probe-project",
  jurisdictions: ["US"], platforms: ["probe-platform"], goods: "probe goods",
  upfrontInstructions: "probe instructions", brief: "probe brief", rawRequest: "probe raw",
  deliverableSpec: "probe spec", commercialFlexibility: "probe flex", priorUse: "probe use",
  campaignShape: "probe shape", deadline: "2026-12-31", nativeLanguage: true, caseLaw: true,
  searchLevel: "probe-level",
  // POSITIVE-ONLY booleans: `=== true` in the builder, so nothing looser may be probed with
  customerUnknown: true, dupOverride: true, clientPrincipal: true, demoRun: true,
  // marks[] is the batch form; the single-mark form derives it, so probe the batch shape explicitly
  marks: [{ name: "PROBEMARK", classes: [9] }],
  // `geography` is the ONE field whose ARGS key differs from its JOB key: the builder reads
  // `args.worldwide` — a positive instruction — and emits the stamp. Probing "geography" directly would
  // report a false miss on a field that works.
  geography: { __argsKey: "worldwide", value: true },
  // The door stamps these from its own clock and identity; there is no args value and none should win.
  id: { __doorStamped: true }, enqueuedAt: { __doorStamped: true },
  enqueuedBy: { __doorStamped: true }, enqueuedVia: { __doorStamped: true },
});

test("2049: every field start_run DECLARES it carries is a field buildJob actually READS", () => {
  const carried = [...START_RUN_JOB_FIELDS.carries].sort();
  const unprobed = carried.filter((f) => !(f in PROBE));
  assert.deepEqual(unprobed, [],
    `${unprobed.length} carried field(s) have no probe value here, so this test cannot say whether the `
    + `builder reads them: ${unprobed.join(", ")}. Add each to PROBE — a field nobody probes is the `
    + `silent-drop shape this arm exists to end.`);

  const args = {};
  for (const f of carried) {
    const p = PROBE[f];
    if (p && typeof p === "object" && p.__doorStamped) continue;          // no args value by design
    if (p && typeof p === "object" && p.__argsKey) { args[p.__argsKey] = p.value; continue; }
    args[f] = p;
  }
  const job = buildJob(args, { scope: { kind: "ops", sub: "probe" } });

  const dropped = carried.filter((f) => job[f] === undefined);
  assert.deepEqual(dropped, [],
    `${dropped.length} field(s) are DECLARED carried and the builder does not read them: `
    + `${dropped.join(", ")}. An allow-list drops what it does not name WITHOUT SAYING SO, so the door `
    + `advertises a field it silently cannot deliver — which is exactly what demoRun did.`);
});

test("2049: demoRun reaches the job on `true` alone — absent stays absent, truthy stays absent", () => {
  const base = { markName: "PROBEMARK", forwarder: "probe-forwarder" };
  const build = (extra) => buildJob({ ...base, ...extra }, { scope: { kind: "ops", sub: "probe" } });

  assert.equal(build({ demoRun: true }).demoRun, true, "an operator door cannot declare a demo run");

  // ABSENT STAYS ABSENT, and the polarity is the whole point: `demoRunAgreement` reads the flag's
  // PRESENCE, so a field that defaulted to false would be a statement rather than a silence.
  assert.equal("demoRun" in build({}), false, "an ordinary job acquired a demoRun key");

  // AND NOTHING LOOSER THAN `true`. The flag produces a banner asserting the report is FICTION. A
  // truthy string or a 1 arriving from a hand-rolled call, a stale client or a form that stringifies
  // its checkboxes must never be able to mark a real client's report fiction on a value nobody typed
  // deliberately — `demoRunShape` says the same thing at the wall, and this is the door agreeing.
  for (const loose of ["true", "yes", 1, [], {}, "1"])
    assert.equal("demoRun" in build({ demoRun: loose }), false,
      `demoRun: ${JSON.stringify(loose)} marked a report fiction — only \`=== true\` may`);

  // The dangerous direction, stated as its own assertion: false is not a demo run either.
  assert.equal("demoRun" in build({ demoRun: false }), false, "demoRun:false put a key on the job");
});

test("DECLARED_JOB_FIELDS covers the job shape the schema documents and the MCP faces offer", () => {
  const declared = new Set(DECLARED_JOB_FIELDS);
  // EXAMPLE_JOB is enqueue-schema's own worked example of an assembled job. Every key of it is a field a
  // job carries, so every key of it must be declared — the list cannot be a list somebody remembered.
  for (const k of Object.keys(EXAMPLE_JOB))
    assert.ok(declared.has(k), `EXAMPLE_JOB carries ${k} and DECLARED_JOB_FIELDS does not declare it`);
  // AND THE WIRE. Every property the MCP faces OFFER that is a job field must be declared, because a
  // field a schema invites is a field an agent will send — which is exactly what deliveryRoute was.
  const NOT_JOB_FIELDS = new Set(["agent", "worldwide"]);   // routing/telling, not stored on the job
  for (const verb of ["start_run", "plan_run"]) {
    const tool = TOOL_DEFS.find((t) => t.name === verb);
    assert.ok(tool, `${verb} is no longer an MCP tool — this assertion is measuring nothing`);
    for (const prop of Object.keys(tool.inputSchema.properties)) {
      if (NOT_JOB_FIELDS.has(prop)) continue;
      assert.ok(declared.has(prop), `${verb} offers "${prop}" and DECLARED_JOB_FIELDS does not declare it`);
    }
  }
  assert.ok(declared.has("deliveryRoute"), "the field this whole mechanism exists for");
});
