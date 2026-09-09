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
import { makeProfileService, browserRefusal } from "../profile-service.mjs";
import { Refusal } from "../../shared/onboarding-store.mjs";
import { readFileSync } from "node:fs";
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
  // PINNED TO WHAT THE REFUSAL MUST CARRY, not to its words. This used to match the command line's own
  // sentence — and the command line's sentence is the wrong one to send a browser: it names the flag that
  // was missing and the directory that was written to, neither of which the person on the New company
  // page has ever seen. The wording is now each door's own, so the rule here is what the browser's
  // refusal has to DO: name the key, and carry the code that lets the screen offer a way to that company.
  assert.equal(dup.json.code, "key_exists", "the screen can act on the kind, not on the prose");
  assert.equal(dup.json.key, "acme", "and it knows WHICH company already holds it");
  assert.match(dup.json.message, /acme/, "the sentence names it too, for a reader who only sees the text");
  assert.doesNotMatch(dup.json.message, /--|\/(home|srv|tmp|var)\//,
    "no flag names and no filesystem paths reach a browser");

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

test("NO REFUSAL SENDS TERMINAL VOCABULARY TO A BROWSER", () => {
  // The shared create path's own sentences are written for somebody standing in a terminal: they name
  // the flag that was missing and the directory that was written to, which is right for that reader and
  // useless to a lawyer on the New company page. Each refusal now carries a code, and this door words it.
  //
  // Driven over EVERY code the shared path can raise rather than the two that were easy to reach, and
  // taken from the create path itself rather than a list retyped here — a code added there without a
  // wording here fails this rather than reaching somebody as a flag name.
  const cases = [
    { code: "key_exists", detail: { key: "acme" } },
    { code: "domain_claimed", detail: { domain: "acme.example", heldBy: "other" } },
    { code: "no_marketplaces", detail: {} },
    { code: "framework_missing", detail: { path: "own/deck.md" } },
    { code: "invalid_bundle", detail: { errors: ["profiles/acme.json: name is required"] } },
  ];

  // FLOOR: every code the create path actually raises is covered above. A silently shrinking list is how
  // this arm would pass while a new refusal reached a browser saying "--platforms".
  const src = readFileSync(new URL("../company-bundle.mjs", import.meta.url), "utf8");
  const raised = [...src.matchAll(/code:\s*"([a-z_]+)"/g)].map((m) => m[1]).sort();
  assert.deepEqual(raised, cases.map((c) => c.code).sort(),
    "every refusal the create path raises is worded for the browser here");

  for (const { code, detail } of cases) {
    const e = new Refusal("no --platforms was given; repair the generic profile in /srv/store", { code, ...detail });
    const worded = browserRefusal(e);
    assert.equal(worded.code, code, `${code} keeps its kind`);
    assert.ok(worded.message && worded.message.length > 20, `${code} says something a person can read`);
    assert.doesNotMatch(worded.message, /--[a-z]/, `${code} names no command-line flag`);
    assert.doesNotMatch(worded.message, /\/(home|srv|tmp|var|Users)\//, `${code} prints no filesystem path`);
    assert.doesNotMatch(worded.message, /brand owner/i, `${code} does not use the retired noun`);
  }

  // The other direction: an UNKNOWN code must still say something. An unworded refusal becoming a silent
  // one is worse than an unworded refusal.
  const unknown = browserRefusal(new Refusal("something else went wrong", { code: "not_a_code_we_word" }));
  assert.match(unknown.message, /something else went wrong/);
});
