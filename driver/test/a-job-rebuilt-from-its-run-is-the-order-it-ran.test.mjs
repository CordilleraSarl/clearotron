// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// a-job-rebuilt-from-its-run-is-the-order-it-ran.test.mjs — a job read back out of a run's status takes the
// order's marks, goods and applicant from the run's instructed scope, its account from the frozen profile and
// its product from the frozen search policy.
//
// THE DEFECT. `--resume` and `--experiment` rebuild the job from status.json, which carries the run's identity
// and none of these. A stage re-run on a saved run was handed a different job from the one the run had, and
// nothing showed it: the frame messages lost the goods line, the self-exclusion seed lost the applicant, a
// resume's failure notice named no product, and the account resolved to `generic`, which the resume logged as
// a mismatch with the run's own frozen profile. Every one of those fields is still in the run's files.
//
// THE ACCOUNT HAS A TRAP, and it is driven below on the door itself: the run context resolves the account
// through the roster, which refuses a key it does not hold. A copy of the run read where the roster lacks the
// account is rebuilt without it, as before, rather than refused for a field the resume does not need.
//
// Every mark, company and account here is invented.
//
// Run:  node --test driver/test/a-job-rebuilt-from-its-run-is-the-order-it-ran.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { jobFromStatus, instructedScopeOf, composeDispatchExtra } from "../pipeline.mjs";
import { frontMatterIdentity } from "../stages.mjs";
import { resolveProfile, loadProfiles } from "../profiles.mjs";
import { buildRunContext } from "../phase0.mjs";
import { policyFor, reportIdentityFor } from "../search-policy.mjs";
import { preflightResearchCredential } from "../driver.config.mjs";

const ORDER = {
  id: "job-1244", ref: "INV-1244", markName: "QUILLMERE", marks: [{ name: "QUILLMERE" }], classes: [9, 42],
  forwarder: "invented-forwarder", goods: "planning software for invented gardens", customer: "Invented Holdings",
  jurisdictions: ["US", "EU"], geography: { mode: "named", origin: "request" },
  profileKey: "invented-account", product: "full-country-search",
};
/** What seedRunStatus keeps of a job: its identity. */
const statusOf = (job) => ({ id: job.id, ref: job.ref, markName: job.markName, classes: job.classes, forwarder: job.forwarder });
/** The run's frozen profile and search policy, in the fields the rebuild reads. */
const PROFILE = { profileKey: "invented-account", name: "Invented Holdings" };
const POLICY = { schema: 1, level: "full-country-search", pipeline: "clearance", origins: { level: "job.product" } };
/** A roster holding the account, as on the install that ran the run, and one without it. */
const generic = { key: "generic", name: "Generic", matchDomains: [] };
const HOME_ROSTER = new Map([["generic", generic], ["invented-account", { key: "invented-account", name: "Invented Holdings", matchDomains: [] }]]);
const FOREIGN_ROSTER = new Map([["generic", generic]]);

const rebuild = (frozen = { profile: PROFILE, searchPolicy: POLICY, roster: HOME_ROSTER }) =>
  jobFromStatus(statusOf(ORDER), instructedScopeOf(ORDER), frozen);

test("the rebuilt job carries the order's marks, goods and applicant, so the matter it asks for is the order's", () => {
  const rebuilt = rebuild();
  assert.deepEqual(rebuilt.marks, [{ name: "QUILLMERE" }]);
  assert.equal(rebuilt.goods, ORDER.goods);
  assert.equal(rebuilt.customer, ORDER.customer);
  assert.deepEqual(instructedScopeOf(rebuilt), instructedScopeOf(ORDER), "the rebuilt job asks for a different matter from the order's");
});

test("a message built from the rebuilt job is the one built from the order", () => {
  const rebuilt = rebuild();
  assert.equal(frontMatterIdentity({ job: rebuilt, profile: PROFILE }), frontMatterIdentity({ job: ORDER, profile: PROFILE }));
  assert.match(frontMatterIdentity({ job: rebuilt, profile: PROFILE }), /- use: planning software/, "the goods line is missing");

  // The review's plain-words block reads the marks list: the rebuilt job is told what the order's run was told.
  const dir = mkdtempSync(join(tmpdir(), "rebuilt-job-"));
  try {
    const doc = JSON.parse(readFileSync(new URL("../../demo/global-preliminary-search/run/findings.json", import.meta.url), "utf8"));
    doc.findings = doc.findings.map((f, i) => (i === 0 ? { ...f, net: "The proprietor holds a subsisting right." } : f));
    const findings = join(dir, "findings.json");
    writeFileSync(findings, JSON.stringify(doc));
    const told = (job) => composeDispatchExtra("narrative-refutation", { paths: { findings, runDir: "/nonexistent" }, job });
    const [fromOrder, fromRebuilt] = [told(ORDER), told(rebuilt)];
    assert.ok(fromOrder.ids.some((x) => x.id === "refute-plain-register"), "guard: the block was not built, so this compares nothing");
    assert.match(fromOrder.text, /The 1 mark\(s\) this run is about were removed before reading/);
    assert.equal(fromRebuilt.text, fromOrder.text);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("the account comes from the frozen profile, and resolves to the run's own", () => {
  const rebuilt = rebuild();
  assert.equal(rebuilt.profileKey, "invented-account");
  assert.equal(resolveProfile(rebuilt, { profiles: HOME_ROSTER }).key, "invented-account");
  // Before, the job named no account and no domain, so it resolved to generic: a mismatch with the frozen profile.
  const identityOnly = jobFromStatus(statusOf(ORDER), instructedScopeOf(ORDER));
  assert.equal(resolveProfile(identityOnly, { profiles: HOME_ROSTER }).key, "generic", "guard: without the account the job resolves elsewhere");
});

test("on a roster without the account the job is rebuilt without it, and the run context is not refused", () => {
  const foreign = rebuild({ profile: PROFILE, searchPolicy: POLICY, roster: FOREIGN_ROSTER });
  assert.equal(foreign.profileKey, undefined, "an account this roster lacks rode on the job");
  assert.equal(resolveProfile(foreign, { profiles: FOREIGN_ROSTER }).key, "generic");
  assert.throws(() => resolveProfile({ ...foreign, profileKey: "invented-account" }, { profiles: FOREIGN_ROSTER }), /profile_key_unknown/,
    "guard: a roster without the account refuses its key, so this arm drives the trap");
  // The door itself, on the roster this process reads, which holds no invented account.
  const at = { studioRoot: "/nonexistent-studio", archiveRoot: "/nonexistent-archive", codename: "invented-codename", date: "2026-10-30" };
  assert.throws(() => buildRunContext({ ...foreign, profileKey: "invented-account" }, at), /profile_key_unknown/);
  const here = rebuild({ profile: PROFILE, searchPolicy: POLICY, roster: loadProfiles() });
  assert.equal(here.profileKey, undefined);
  assert.doesNotThrow(() => buildRunContext(here, at), "a rebuilt job was refused for an account the resume does not need");
});

test("the product comes back only when the order named it, and a resume's doors read it as the run's did", () => {
  const rebuilt = rebuild();
  assert.equal(rebuilt.product, "full-country-search");
  assert.deepEqual(policyFor(rebuilt.product), policyFor(ORDER.product));
  assert.equal(reportIdentityFor(rebuilt.product).identity, reportIdentityFor(ORDER.product).identity, "a resume's failure notice names another product");
  // The research-credential door reads the job's product: without the key it refuses the rebuilt job where it refused the order.
  const door = (job) => { try { preflightResearchCredential(policyFor(String(job.product ?? "").trim().toLowerCase()), {}); return "open"; } catch { return "refused"; } };
  assert.equal(door(ORDER), "refused", "guard: the order's product needs the research credential, or this compares nothing");
  assert.equal(door(rebuilt), door(ORDER));
  for (const origin of ["job.recipeKey", "profile.defaultProduct", "project.defaultProduct", "the-scope"]) {
    const r = rebuild({ profile: PROFILE, searchPolicy: { ...POLICY, origins: { level: origin } }, roster: HOME_ROSTER });
    assert.equal(r.product, undefined, `a product resolved from ${origin}, which no order carried, was put on the job`);
  }
});

test("with no scope and no frozen files the rebuild is the run's identity, as before", () => {
  assert.deepEqual(Object.keys(jobFromStatus(statusOf(ORDER), null, {})).sort(), ["classes", "forwarder", "id", "markName", "ref"]);
});
