// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// Creating a company from the browser: what it writes, and what it refuses before writing anything.
//
// THE DEFECT THIS EXISTS FOR. `save` is an upsert and looks like a create path. It is not one:
// `preserveCodeOwned` takes the on-disk value of every code-owned field and deletes the field when there
// is none, and a company being created has nothing on disk. So a create routed through save writes no
// `frameworkPath` — silently — and the company is rated under the house default from then on. That is
// live today through the staff pool page, and the first arm below is the one that would have caught it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeProfileService } from "../profile-service.mjs";
import { DEFAULT_FRAMEWORK } from "../framework.mjs";

const STAFF = { email: "staff@example-firm.com" };

function svc() {
  const dir = mkdtempSync(join(tmpdir(), "company-create-"));
  writeFileSync(join(dir, "generic.json"),
    JSON.stringify({ name: "Generic default", platforms: ["amazon.com", "apps.apple.com", "play.google.com"] }));
  writeFileSync(join(dir, "acme.json"),
    JSON.stringify({ name: "Acme", matchDomains: ["acme.example"], platforms: ["amazon.com"] }));
  const writeCalls = [], commitCalls = [];
  const service = makeProfileService({
    profileDir: dir,
    writeProfile: (a) => { writeCalls.push(a); return { files: [`${a.key}.json`] }; },
    gitCommit: (a) => { commitCalls.push(a); return "deadbeefsha"; },
    audit: () => {},
  });
  return { service, writeCalls, commitCalls };
}

test("a company created from the browser always carries a framework, and says which", async () => {
  const { service, writeCalls } = svc();
  const r = await service.route("POST", "/profiles", STAFF, { name: "Bellweather Foods" });
  assert.equal(r.status, 201);

  // THE ARM THAT MATTERS. Absent is the failure being prevented, so this asserts the VALUE is present
  // on the bundle that reached the writer — not that the response mentioned a framework.
  const written = writeCalls.at(-1).profile;
  assert.equal(written.frameworkPath, DEFAULT_FRAMEWORK,
    "a created company is rated under a framework that was chosen, never one that was left absent");

  // And the receipt can say which one and whether it was a default, without restating what was typed.
  assert.equal(r.json.framework.defaulted, true);
  assert.equal(r.json.marketplaces.defaulted, true);
  assert.equal(r.json.marketplaces.count, 3, "the house default list, read from generic — never hardcoded");
  assert.deepEqual(written.platforms, ["amazon.com", "apps.apple.com", "play.google.com"]);
});

test("the key comes from the name, and a name that yields none is refused rather than invented", async () => {
  const { service } = svc();
  const ok = await service.route("POST", "/profiles", STAFF, { name: "Zürich Präzision AG" });
  assert.equal(ok.status, 201);
  assert.equal(ok.json.key, "zurich-prazision-ag", "accents are folded, not turned into separators");

  const none = await service.route("POST", "/profiles", STAFF, { name: "!!!" });
  assert.equal(none.status, 400);
  assert.equal(none.json.error, "needs_key", "a key nobody chose is worse than asking for one");
});

test("a domain another company already claims is refused BEFORE anything is written", async () => {
  const { service, writeCalls, commitCalls } = svc();
  const r = await service.route("POST", "/profiles", STAFF,
    { name: "Acme Rivals", matchDomains: ["acme.example"] });
  assert.equal(r.status, 400);
  assert.match(r.json.message, /acme/, "the refusal names the company already holding it");

  // NOTHING WAS WRITTEN, and this is the half worth asserting: a colliding domain does not fail this
  // company, it stops the deployment resolving ANY company at the next start. A refusal that arrived
  // after the write would leave the store unloadable.
  assert.equal(writeCalls.length, 0, "no write");
  assert.equal(commitCalls.length, 0, "no commit");
});

test("an existing key is refused, and so is the house default's own key", async () => {
  const { service, writeCalls } = svc();
  const dup = await service.route("POST", "/profiles", STAFF, { name: "Acme", key: "acme" });
  assert.equal(dup.status, 400);
  assert.match(dup.json.message, /already exists/);

  // `generic` is the fallback every unprofiled clearance resolves to. The key rule's own comment claimed
  // the create path never allowed it while the regex matched it happily, so the rule was a sentence
  // rather than a check. Creating it would shadow the bundled fallback for every job naming no company.
  const houses = await service.route("POST", "/profiles", STAFF, { name: "Generic", key: "generic" });
  assert.equal(houses.status, 400);
  assert.match(houses.json.message, /house default/);

  assert.equal(writeCalls.length, 0, "neither refusal wrote anything");
});

test("written and recorded are two events, and a failed commit is not reported as a failed create", async () => {
  const dir = mkdtempSync(join(tmpdir(), "company-create-nogit-"));
  writeFileSync(join(dir, "generic.json"), JSON.stringify({ name: "Generic default", platforms: ["amazon.com"] }));
  const service = makeProfileService({
    profileDir: dir,
    writeProfile: (a) => ({ files: [`${a.key}.json`] }),
    gitCommit: () => { throw new Error("index.lock exists"); },
    audit: () => {},
  });
  const r = await service.route("POST", "/profiles", STAFF, { name: "Ferrymead Instruments" });

  // The write is live the instant it renames. Telling somebody nothing happened, about a company that is
  // already governing runs, is the wrong half to report.
  assert.equal(r.status, 201);
  assert.equal(r.json.written, true);
  assert.equal(r.json.commit, null, "the commit did not happen and the response says so");
  assert.match(r.json.commitError, /created and LIVE/,
    "and it says which half failed, so the receipt can show it in red rather than green");
});

test("a name is required, and the refusal is the one a person can act on", async () => {
  const { service } = svc();
  const r = await service.route("POST", "/profiles", STAFF, {});
  assert.equal(r.status, 400);
  assert.equal(r.json.error, "needs_name");
  assert.match(r.json.message, /needs a name/i);
});
