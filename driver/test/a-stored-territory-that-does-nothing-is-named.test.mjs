// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// A default territory the engine cannot search is NAMED to the person whose profile holds it.
//
// THE DEFECT THIS EXISTS FOR, and the second half of it is the one that was nearly missed. The entry is
// dropped before the prompt, silently — that is the half the tracker names. The half it understates is
// that the profile screen shows the entry back exactly as it was typed, so the setting reads as in force
// on the one screen built to show what is in force, and the only way to find out otherwise is to read a
// finished run's prompt.
//
// Refusing new ones at the point of entry does nothing for a profile that already holds one, and every
// profile written before that refusal existed may. So this drives the READ path: what the profile route
// answers for a profile with a bad entry already on disk.
//
// It drives the route rather than asserting the helper. A value computed and returned that no caller
// reads satisfies nothing, and that is exactly what the first attempt at this shipped: the scope object
// carried the finding and every consumer of that object ignored it.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeProfileService } from "../profile-service.mjs";

const STAFF = { email: "staff@example-firm.com" };

function serviceHolding(defaultJurisdictions) {
  const dir = mkdtempSync(join(tmpdir(), "unsearchable-territory-"));
  writeFileSync(join(dir, "generic.json"),
    JSON.stringify({ name: "Generic default", platforms: ["amazon.com"] }));
  writeFileSync(join(dir, "acme.json"), JSON.stringify({
    name: "Acme Ltd",
    platforms: ["amazon.com"],
    defaultJurisdictions,
  }));
  return makeProfileService({
    profileDir: dir,
    writeProfile: () => ({ files: [] }),
    gitCommit: () => "sha",
    audit: () => {},
  });
}

const read = async (svc) => svc.route("GET", "/profiles/acme", STAFF, {});

test("A STORED TERRITORY THE ENGINE CANNOT SEARCH IS NAMED ON THE PROFILE ROUTE", async () => {
  // The tracker's own example, beside a plausible typo and two entries that are perfectly good.
  const r = await read(serviceHolding(["US", "United States", "USFrance", "Narnia"]));
  assert.equal(r.status, 200);

  const named = r.json?.derived?.unrecognizedTerritories;
  assert.ok(Array.isArray(named), "the profile route answers with the finding, not only with the values");
  assert.deepEqual(named, ["USFrance", "Narnia"], "NAMED, so a reader knows WHICH of four is wrong");

  // The stored values themselves are untouched. This reports; it does not narrow — what a stored default
  // DOES is a decision about what a client receives, and it is not this change's to take.
  assert.deepEqual(r.json.profile.defaultJurisdictions, ["US", "United States", "USFrance", "Narnia"]);
});

test("A PROFILE WHOSE TERRITORIES ARE ALL SEARCHABLE SAYS NOTHING", async () => {
  // Both directions. An implementation that always reported something would satisfy the arm above and
  // put a permanent warning on every profile in the product.
  const r = await read(serviceHolding(["US", "GB", "European Union"]));
  assert.deepEqual(r.json?.derived?.unrecognizedTerritories, [],
    "nothing to say about a profile with nothing wrong");
});

test("BOTH SPELLINGS OF ONE PLACE ARE ONE PLACE, and neither is reported", async () => {
  // The rule the tracker states last and which a naive vocabulary check breaks first: a code and a
  // display name are the same territory, and flagging either would tell somebody their correct entry is
  // wrong. `EU` and `UK` are the two that a display-name check used to reject.
  const r = await read(serviceHolding(["US", "United States", "EU", "European Union", "UK", "GB"]));
  assert.deepEqual(r.json?.derived?.unrecognizedTerritories, []);
});

test("A PROFILE WITH NO TERRITORIES AT ALL IS NOT A PROFILE WITH A PROBLEM", async () => {
  // An absent field and an empty one both mean "nothing set", and neither is a finding. This is the
  // shape that would make the notice appear on a fresh company on the day it was created.
  for (const stored of [undefined, []]) {
    const r = await read(serviceHolding(stored));
    assert.deepEqual(r.json?.derived?.unrecognizedTerritories, [],
      `${JSON.stringify(stored)} is not a finding`);
  }
});

test("A CREATE NAMING A TERRITORY THE ENGINE CANNOT SEARCH WRITES NOTHING", async () => {
  // The ruling: an entry the engine cannot search is REFUSED where it is typed, on every editor that
  // writes this field. The create route is one of those editors and had no territory check at all — it
  // accepted the value, wrote it, and the entry then did nothing for the life of the company.
  //
  // The assertion that matters is the second one. A refusal that still wrote the file would satisfy a
  // status check and leave the defect exactly where it was.
  const dir = mkdtempSync(join(tmpdir(), "create-bad-territory-"));
  writeFileSync(join(dir, "generic.json"),
    JSON.stringify({ name: "Generic default", platforms: ["amazon.com"] }));
  const written = [];
  const svc = makeProfileService({
    profileDir: dir,
    writeProfile: (a) => { written.push(a.key); return { files: [] }; },
    gitCommit: () => "sha",
    audit: () => {},
  });

  const r = await svc.route("POST", "/profiles", STAFF, {
    name: "Acme Ltd",
    defaultJurisdictions: ["US", "XQ"],
  });

  assert.equal(r.status, 400, "refused");
  assert.deepEqual(written, [], "NOTHING was written");
  assert.match(String(r.json?.message ?? ""), /XQ/, "the refusal names the entry, not just the field");
});

test("A CREATE WHOSE TERRITORIES ARE ALL SEARCHABLE IS WRITTEN", async () => {
  // The other direction. A refusal that fired on everything would pass the arm above and make the form
  // impossible to use, which is the failure mode a one-directional check cannot see.
  const dir = mkdtempSync(join(tmpdir(), "create-good-territory-"));
  writeFileSync(join(dir, "generic.json"),
    JSON.stringify({ name: "Generic default", platforms: ["amazon.com"] }));
  const written = [];
  const svc = makeProfileService({
    profileDir: dir,
    writeProfile: (a) => { written.push(a.key); return { files: [] }; },
    gitCommit: () => "sha",
    audit: () => {},
  });

  const r = await svc.route("POST", "/profiles", STAFF, {
    name: "Acme Ltd",
    defaultJurisdictions: ["US", "European Union", "GB"],
  });

  assert.equal(r.status, 201, `created — got ${r.status} ${JSON.stringify(r.json?.message ?? r.json?.error ?? "")}`);
  assert.deepEqual(written, ["acme-ltd"]);
});
