// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// the-preview-answers-the-demo-question-as-the-claim-does.test.mjs — the free preview asks the same
// demo-data question the claim asks, in the same words.
//
// THE DEFECT. For an account marked demoData, the preview (plan_run) answered wouldRun:true with no
// blockers, and the claim then refused the same order: "… is DEMO DATA … and cannot run a real clearance".
// Nothing was searched or spent, but the free door promised a run the queue refused. The same class as an
// unreadable company's unkeyed order, one question further along.
//
// Its own file because profiles.mjs reads CLEAROTRON_CUSTOMERS_DIR at module load.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { pinEnv } from "../../shared/env-aliases.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const GENERIC = JSON.parse(readFileSync(join(ROOT, "driver", "profiles", "generic.json"), "utf8"));
const store = mkdtempSync(join(tmpdir(), "preview-demo-"));
writeFileSync(join(store, "generic.json"), JSON.stringify(GENERIC));
writeFileSync(join(store, "fiction.json"), JSON.stringify({ ...GENERIC, name: "Fiction Co", matchDomains: ["fiction.example"], demoData: true }));
writeFileSync(join(store, "real.json"), JSON.stringify({ ...GENERIC, name: "Real Co", matchDomains: ["real.example"] }));
pinEnv(process.env, "CLEAROTRON_CUSTOMERS_DIR", store);

const { planRun } = await import("../lib/plan.mjs");
const { resolveProfile, loadProfiles } = await import("../../driver/profiles.mjs");
const { demoRunAgreement } = await import("../../driver/demo-run-agreement.mjs");

const ORDER = { markName: "INVENTED MARK", product: "knockout-search", classes: [9], forwarder: "staff-a" };
// The claim's question, asked with the claim's own inputs: the job and the profile it resolves to.
const claim = (job) => {
  const profile = resolveProfile(job, { profiles: loadProfiles({ force: true }) });
  return demoRunAgreement({ demoRun: job.demoRun === true, demoData: profile?.demoData === true, who: job.profileKey });
};

test("a demo account's ordinary order: the preview refuses in the claim's own sentence", () => {
  const job = { ...ORDER, profileKey: "fiction" };
  const c = claim(job), p = planRun(job);
  assert.equal(c.ok, false, "the claim refuses it");
  assert.equal(p.wouldRun, false, "and the preview no longer promises it would run");
  assert.ok(p.blockers.includes(c.reject), "the blocker is the claim's sentence, word for word");
});

test("every other combination previews as the claim decides it", () => {
  for (const job of [
    { ...ORDER, profileKey: "fiction", demoRun: true },   // demo account, demo order: the honest pair — runs
    { ...ORDER, profileKey: "real" },                     // real account, ordinary order — runs as today
    { ...ORDER, profileKey: "real", demoRun: true },      // real account, demo order — refused the other way
  ]) {
    const c = claim(job), p = planRun(job);
    const demoBlocked = p.blockers.some((b) => /DEMO DATA|REAL account/.test(b));
    assert.equal(demoBlocked, !c.ok, `${job.profileKey}${job.demoRun ? " + demoRun" : ""}: preview and claim agree`);
    if (!c.ok) assert.ok(p.blockers.includes(c.reject));
  }
});

test.after(() => rmSync(store, { recursive: true, force: true }));
