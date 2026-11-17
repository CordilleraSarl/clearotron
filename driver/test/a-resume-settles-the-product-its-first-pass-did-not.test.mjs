// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// @tier full — drives the mock pipeline, both products, each time as a first pass that stops and a resume
//
// A RESUME SETTLES THE PRODUCT ITS FIRST PASS DID NOT, AS A FRESH START WOULD.
//
// A run freezes its account profile and then its product as it opens, before any stage. A first pass that stopped before
// the product was frozen left a run whose resume read the absence as a run from before the freeze: it ran and delivered
// as a clearance under a retired product name, "Preliminary clearance", whatever the client had ordered. An order that
// named its product was refused instead. A resume now finishes the opening from the order the run kept when it was
// accepted and the profile it froze, and delivers the product ordered. If the product cannot be established it stops.
//
// Each first pass is stopped by failing one write once: the product's or the profile's. Nothing dials a register or the
// web: the Knockout's executors are injected, and the engine is the mock.
import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire, syncBuiltinESMExports } from "node:module";
import { driverDir } from "../../shared/driver-dir.mjs";
import { pinEnv } from "../../shared/env-aliases.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const CLAUDE = join(HERE, "mock-claude.mjs");
chmodSync(CLAUDE, 0o755);
const ROOT = mkdtempSync(join(tmpdir(), "resume-settles-the-product-"));
const PROFILES = join(ROOT, "profiles");
cpSync(join(HERE, "..", "profiles"), PROFILES, { recursive: true });
const ACCOUNT = join(PROFILES, "harbour-goods.json");
const account = (defaultProduct) => writeFileSync(ACCOUNT, JSON.stringify({ name: "Harbour Goods", matchDomains: ["harbour-goods.example"], platforms: [], defaultProduct }, null, 2) + "\n");
account("global-preliminary-search");
for (const [k, v] of Object.entries({
  CLEAROTRON_AI: "anthropic-agent", CLEAROTRON_CLAUDE_PATH: CLAUDE, CLEAROTRON_WORK_DIR: join(ROOT, "ws"),
  CLEAROTRON_REPORTS_DIR: join(ROOT, "pool"), CLEAROTRON_REPORTS_URL: "https://trademark.test", CLEAROTRON_CUSTOMERS_DIR: PROFILES,
  CLEAROTRON_REGISTER_CALL_LOG: join(ROOT, "register-calls.jsonl"),
  CLEAROTRON_MAX_RETRIES: "0", CLEAROTRON_RECOVERY_MAX: "0", CLEAROTRON_DEFAULT_AGENT: "intake-agent",
  CLEAROTRON_PLAN_DISPATCH: "off", CLEAROTRON_BAND_TRUTH_GATE: "0", CLEAROTRON_REGISTER_GAP_CLAMP: "0", CLEAROTRON_SATPROBE_CODESIDE: "0",
  MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced", CORSEARCH_SESSION_KEY: "test-offline",
})) pinEnv(process.env, k, v);
pinEnv(process.env, "CLEAROTRON_REGISTER_RECORD_LOG", undefined);
pinEnv(process.env, "CLEAROTRON_SIGNA_ANSWER_MEMORY", undefined);

const { answeredGrid } = await import("./knockout-grid-fixture.mjs");
const { loadProfiles } = await import("../profiles.mjs");
const { reportIdentityFor } = await import("../search-policy.mjs");

const KNOCKOUT_EXECUTORS = {
  recordLister: async () => ({ ok: true, total: null, records: [] }),
  countExecutor: async () => ({ ok: true, total: 0 }),
  gridExecutor: async (spec) => answeredGrid(spec, []),
  sweepExecutor: async () => ({ ok: true, text: "Nothing found." }),
};
const CLEARANCE = { msgId: "<settle@x>", forwarder: "jordan", forwarderDomain: "example.com", markName: "NOVAPULSE", classes: [9, 41], provider: "corsearch" };
const KNOCKOUT = { msgId: "<settle-ko@x>", forwarder: "jordan", forwarderDomain: "example.com", product: "knockout-search", classes: [4], jurisdictions: ["EU"],
  markName: "LANTERNWICK", marks: [{ name: "LANTERNWICK" }, { name: "CLUVENDRA" }] };

const pipelineOf = async () => (await import(`../pipeline.mjs?bust=${Math.random()}`)).pipeline;
const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));
const codenameOf = (runDir) => runDir.split(/[\\/]/).pop().split("-").slice(3).join("-");
const withoutWhen = ({ frozenAt: _frozenAt, ...rest }) => rest;
const opening = (runDir) => ({
  policy: withoutWhen(readJson(driverDir(runDir, "search-policy.json"))),
  profile: readJson(driverDir(runDir, "profile.json")),
  ladder: (() => { const { ts: _ts, ...row } = readFileSync(driverDir(runDir, "run.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l)).filter((r) => r.event === "depth-ladder").at(-1); return row; })(),
});

/** The live run folder that kept order `id`, found by the order it kept: a pass that stops by throwing names none. */
function runKeeping(id) {
  const hit = readdirSync(join(ROOT, "ws"), { recursive: true }).map(String).filter((p) => p.endsWith("accepted-order.json"))
    .map((p) => join(ROOT, "ws", p)).find((p) => readJson(p).order?.id === id);
  assert.ok(hit, `no run kept order ${id}`);
  return dirname(dirname(hit));
}

/** One pass of `order` (with `id`), failing once the first write of a path ending `endsWith`. What it returned or threw, and its run folder. */
async function firstPassStoppedAt(order, endsWith, opts = {}) {
  const fs = createRequire(import.meta.url)("node:fs");
  const real = fs.writeFileSync;
  let faulted = 0;
  fs.writeFileSync = (p, ...rest) => {
    if (!faulted && String(p).endsWith(endsWith)) { faulted++; throw Object.assign(new Error("EIO: a planted write fault"), { code: "EIO" }); }
    return real.call(fs, p, ...rest);
  };
  syncBuiltinESMExports();
  try {
    let res;
    try { res = await (await pipelineOf())(structuredClone(order), opts); } catch (e) { res = { ok: false, threw: String(e?.message ?? e) }; }
    assert.equal(faulted, 1, `the planted fault never reached ${endsWith}, so this arm proves nothing`);
    return { ...res, runDir: runKeeping(order.id) };
  } finally {
    fs.writeFileSync = real;
    syncBuiltinESMExports();
  }
}
const resume = async (order, runDir, opts = {}) => {
  try { return await (await pipelineOf())(structuredClone(order), { ...opts, codename: codenameOf(runDir) }); }
  catch (e) { return { ok: false, threw: String(e?.message ?? e) }; }
};
const policyFile = (runDir) => driverDir(runDir, "search-policy.json");

test("a clearance whose order names no product, stopped before its product was frozen, resumes as the product a fresh start freezes", async () => {
  const control = await (await pipelineOf())({ ...CLEARANCE, id: "settle-control" });
  assert.equal(control.ok, true, JSON.stringify(control));
  const first = await firstPassStoppedAt({ ...CLEARANCE, id: "settle-clearance" }, "search-policy.json.tmp");
  assert.notEqual(first.ok, true, "premise: the first pass stopped");
  assert.ok(!existsSync(policyFile(first.runDir)) && existsSync(driverDir(first.runDir, "profile.json")), "premise: its profile was frozen and its product was not");
  const resumed = await resume({ ...CLEARANCE, id: "settle-clearance" }, first.runDir);
  assert.equal(resumed.ok, true, JSON.stringify(resumed));
  assert.deepEqual(opening(resumed.runDir), opening(control.runDir), "the same product, profile and planned work as a fresh start");
  assert.equal(reportIdentityFor(opening(resumed.runDir).policy).identity, "Global preliminary search");
  assert.doesNotMatch(readJson(driverDir(resumed.runDir, "delivery.json")).subject, /Preliminary clearance/);
});

test("a Knockout whose order names its product, stopped before the product was frozen, resumes as a Knockout", async (t) => {
  pinEnv(process.env, "CLEAROTRON_DATABASE", "signa");
  t.after(() => pinEnv(process.env, "CLEAROTRON_DATABASE", undefined));
  const control = await (await pipelineOf())({ ...KNOCKOUT, id: "settle-ko-control" }, KNOCKOUT_EXECUTORS);
  assert.equal(control.ok, true, JSON.stringify(control));
  const first = await firstPassStoppedAt({ ...KNOCKOUT, id: "settle-ko" }, "search-policy.json.tmp", KNOCKOUT_EXECUTORS);
  assert.notEqual(first.ok, true, "premise: the first pass stopped");
  const resumed = await resume({ ...KNOCKOUT, id: "settle-ko" }, first.runDir, KNOCKOUT_EXECUTORS);
  assert.equal(resumed.ok, true, `the resume refused a Knockout it can settle: ${JSON.stringify(resumed)}`);
  assert.deepEqual(opening(resumed.runDir), opening(control.runDir));
  assert.equal(opening(resumed.runDir).policy.pipeline, "knockout");
});

test("a run stopped before its profile was frozen resolves it from the order it kept, as a fresh start does", async () => {
  const control = await (await pipelineOf())({ ...CLEARANCE, id: "settle-profile-control", profileKey: "harbour-goods" });
  const first = await firstPassStoppedAt({ ...CLEARANCE, id: "settle-profile", profileKey: "harbour-goods" }, "profile.json.tmp");
  assert.notEqual(first.ok, true, "premise: the first pass stopped");
  assert.ok(!existsSync(driverDir(first.runDir, "profile.json")), "premise: no profile was frozen");
  const resumed = await resume({ ...CLEARANCE, id: "settle-profile", profileKey: "harbour-goods" }, first.runDir);
  assert.equal(resumed.ok, true, JSON.stringify(resumed));
  assert.deepEqual(opening(resumed.runDir), opening(control.runDir), "a profile, not a profile-free run, and the same product");
  assert.equal(opening(resumed.runDir).profile.profileKey, "harbour-goods");
});

test("an account default changed after the run froze its profile does not reach the resumed run", async () => {
  account("global-preliminary-search");
  loadProfiles({ force: true });
  const order = { ...CLEARANCE, id: "settle-default", profileKey: "harbour-goods", jurisdictions: ["US", "CH"] };
  const first = await firstPassStoppedAt(order, "search-policy.json.tmp");
  assert.equal(readJson(driverDir(first.runDir, "profile.json")).defaultProduct, "global-preliminary-search", "premise: the frozen profile holds the default the order met");
  account("multi-country-focus-search");
  loadProfiles({ force: true });
  try {
    const fresh = await (await pipelineOf())({ ...order, id: "settle-default-fresh" });
    assert.equal(opening(fresh.runDir).policy.level, "multi-country-focus-search", "premise: a fresh start now takes the new default");
    const resumed = await resume(order, first.runDir);
    assert.equal(resumed.ok, true, JSON.stringify(resumed));
    assert.equal(opening(resumed.runDir).policy.level, "global-preliminary-search", "the resumed run keeps the default its order met");
  } finally {
    account("global-preliminary-search");
    loadProfiles({ force: true });
  }
});

test("a corrupt frozen product is refused, and left as it is", async () => {
  const first = await firstPassStoppedAt({ ...CLEARANCE, id: "settle-corrupt" }, "search-policy.json.tmp");
  writeFileSync(policyFile(first.runDir), "{ not a policy");
  const resumed = await resume({ ...CLEARANCE, id: "settle-corrupt" }, first.runDir);
  assert.notEqual(resumed.ok, true, "a corrupt record is not an absent one");
  assert.equal(readFileSync(policyFile(first.runDir), "utf8"), "{ not a policy", "the record is never replaced");
});

test("a run that holds stage work but no frozen product is refused: that work cannot be shown to be for the product ordered", async () => {
  process.env.MOCK_FAIL_STAGE = "joint synthesis narrative";
  let first;
  try { first = await (await pipelineOf())({ ...CLEARANCE, id: "settle-work" }); } finally { delete process.env.MOCK_FAIL_STAGE; }
  assert.notEqual(first.ok, true, "premise: the first pass stopped after its stages ran");
  rmSync(policyFile(first.runDir));
  const resumed = await resume({ ...CLEARANCE, id: "settle-work" }, first.runDir);
  assert.notEqual(resumed.ok, true, "the run was resumed on a product settled after its work");
  assert.ok(!existsSync(policyFile(first.runDir)), "no product was settled under the work");
  const said = [JSON.stringify(resumed), ...[".failed", "status.json"].map((f) => { try { return readFileSync(join(first.runDir, f), "utf8"); } catch { return ""; } })].join("\n");
  assert.match(said, /holds stage work/, `the refusal does not say why: ${JSON.stringify(resumed).slice(0, 400)}`);
});
