// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A REMOVED CONTROL DOES NOT DELETE THE SETTING BEHIND IT — items 6 and 8.
//
// ── THE RULING ──────────────────────────────────────────────────────────────────────────────────────
//
// Owner, 2026-08-29: "if it doesn't actually affect search why is it there — get rid of it completely.
// there is no such thing as staff only." The marketplace listing-size control is gone from BOTH surfaces
// — the brand-owner page (portal-ui/src/contract/profileFields.ts) and the staff editor
// (driver/profile-page.html), which carried it twice.
//
// ── WHY REMOVING IT WAS DANGEROUS, AND WHAT THIS FILE IS FOR ────────────────────────────────────────
//
// The CONTROL is what the owner ruled on. The stored FIELD is not cosmetic: `marketplaceDensity: "dense"`
// drops the grid cell budget from 98 to 16 so a byte-heavy marketplace's verbatim stdout cannot overflow
// the worker output channel and truncate the ledger mid-JSON. That is a measured incident, cited by name
// above profiles.mjs gridCellBudget, and three shipped profiles carry the setting today.
//
// The staff editor RECONSTRUCTS its save payload from form inputs rather than seeding from the server's
// object. So deleting the input deletes the key from every save that page makes, and the server wrote
// what it was sent — `marketplaceDensity` is not code-owned and had no preserve. The first staff save on
// any dense customer would have silently reset them to sparse and re-armed the crash. Nothing would have
// reported an error; the profile would simply have been quietly wrong.
//
// So the removal is only safe in company with driver/profile-service.mjs's preserve, and this file is the
// proof that the two are still in company. The absence arms alone would pass just as happily on the
// dangerous version of this change — which is the point: an absence is easy to assert and easy to get
// wrong, so the arms that matter here are the ones that drive a real save.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { makeProfileService } from "../profile-service.mjs";
import { gridCellBudget, DENSE_GRID_CELLS, SAFE_GRID_CELLS } from "../profiles.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const STAFF = { email: "staff@example-firm.com" };

/** A service over a temp dir holding one DENSE customer — the profile that has something to lose. */
function svc() {
  const dir = mkdtempSync(join(tmpdir(), "density-removal-"));
  // generic.json is the universal fallback and loadProfiles REFUSES a dir without it.
  writeFileSync(join(dir, "generic.json"), JSON.stringify({ name: "House default", platforms: ["amazon.com"] }));
  writeFileSync(join(dir, "bulkmart.json"), JSON.stringify({
    name: "Bulkmart", platforms: ["amazon.com", "gnc.com"], marketplaceDensity: "dense", demoData: true,
  }));
  const writeCalls = [], overlayCalls = [];
  const service = makeProfileService({
    profileDir: dir,
    writeProfile: (a) => { writeCalls.push(a); return { files: [`${a.key}.json`] }; },
    // The overlay door writes through its OWN injected writer. An arm watching writeProfile sees a
    // project save as zero writes and a 200 — which is what happened when this file was first run.
    writeProject: (a) => { overlayCalls.push(a); return { files: [`projects/${a.customer}/${a.project}.json`] }; },
    gitCommit: () => "deadbeefsha",
    audit: () => {},
  });
  return { service, dir, writeCalls, overlayCalls };
}

/** The body the staff editor now posts: every field it still has an input for, and no density. */
const BODY_WITHOUT_DENSITY = { name: "Bulkmart", platforms: ["amazon.com", "gnc.com"] };

test("no surface offers the control any more — neither page renders an input for it", () => {
  const portal = readFileSync(join(ROOT, "portal-ui", "src", "contract", "profileFields.ts"), "utf8");
  const staff = readFileSync(join(ROOT, "driver", "profile-page.html"), "utf8");

  // ANTI-VACUITY: prove these scans can see a control at all before trusting them not to see this one.
  assert.match(portal, /key: 'platforms'/, "the portal field list could not be read — the absence below would be free");
  assert.ok(staff.includes('"f_platforms"'), "the staff editor's fields could not be read");

  assert.doesNotMatch(portal, /key: 'marketplaceDensity'/,
    "the brand-owner page still declares a marketplaceDensity field — the owner ruled it removed entirely");
  for (const id of ["f_density", "p_density"])
    assert.equal(staff.includes(id), false,
      `the staff editor still carries the ${id} control — "there is no such thing as staff only"`);
});

test("a save that omits the field KEEPS the stored value — the arm that stops a truncation crash", async () => {
  const { service, writeCalls } = svc();
  const r = await service.route("POST", "/profiles/bulkmart/save", STAFF, { profile: { ...BODY_WITHOUT_DENSITY } });

  // THE HARNESS IS PART OF THE MEASUREMENT. A save that 400s writes nothing, and an arm reading
  // writeCalls[0] would throw rather than report — but a save that silently no-ops would let the
  // assertion below pass on an empty array. Both are excluded before the claim is made.
  assert.equal(r.status, 200, `the save did not succeed, so this arm never reached the write: ${JSON.stringify(r.json)}`);
  assert.equal(writeCalls.length, 1, "exactly one write is what this arm is about");

  const written = writeCalls[0].profile;
  assert.equal(written.marketplaceDensity, "dense",
    "a staff save that omits marketplaceDensity STRIPPED it. The control is gone from every page, so every "
    + "save now omits it — this profile has just been reset to the sparse grid budget, and the next dense "
    + "run truncates its ledger mid-JSON. See profiles.mjs gridCellBudget for the incident.");

  // And the value that survived is the value that does the work — the removal kept the setting, not just
  // the string. Without this line the arm proves a key was copied, not that anything still happens.
  assert.equal(gridCellBudget(written), DENSE_GRID_CELLS, "the surviving value no longer selects the dense budget");
  assert.notEqual(DENSE_GRID_CELLS, SAFE_GRID_CELLS, "the two budgets are equal, so the assertion above distinguishes nothing");
});

test("2012 the demo marker survives a staff save too — it never had a control at all", async () => {
  // marketplaceDensity lost its control by ruling; `demoData` never had one. Same position, same strip:
  // profile-page.html reconstructs its payload from the inputs it has, so a key with no input is absent
  // from every save that page makes.
  //
  // AND THIS ONE FAILS SILENT IN THE WORST DIRECTION. A stripped density value re-arms a truncation
  // crash, which at least eventually shows. A stripped demo marker turns an account that is fiction into
  // one indistinguishable from a client — it does not look like an error, it looks like a real customer,
  // and the next clearance under it runs.
  const { service, writeCalls } = svc();
  const r = await (service.route("POST", "/profiles/bulkmart/save", STAFF, { profile: { ...BODY_WITHOUT_DENSITY } }));
  assert.equal(r.status, 200, `save failed: ${JSON.stringify(r.json)}`);
  assert.equal(writeCalls[0].profile.demoData, true,
    "a staff save stripped the demo marker. That account is now indistinguishable from a real client, "
    + "and the wall that refuses a clearance on demo data has nothing left to read.");
});

test("a body that TRIES to set the field cannot — the on-disk value wins", async () => {
  // No surface offers this control, so a body carrying it is a stale tab or a hand-rolled call. Neither
  // is an instruction, and the ruling was that no page anywhere sets this.
  const { service, writeCalls } = svc();
  const r = await service.route("POST", "/profiles/bulkmart/save", STAFF,
    { profile: { ...BODY_WITHOUT_DENSITY, marketplaceDensity: "sparse" } });
  assert.equal(r.status, 200, `save failed: ${JSON.stringify(r.json)}`);
  assert.equal(writeCalls[0].profile.marketplaceDensity, "dense",
    "a request body changed a setting that has no control on any surface");
});

test("a new profile simply has no listing size, and reads as the safe budget", async () => {
  const { service, writeCalls } = svc();
  const r = await service.route("POST", "/profiles/newco/save", STAFF,
    { profile: { name: "Newco", platforms: ["amazon.com"] } });
  assert.equal(r.status, 200, `save failed: ${JSON.stringify(r.json)}`);
  const written = writeCalls[0].profile;
  assert.equal("marketplaceDensity" in written, false,
    "a brand-new profile invented a density; absence is the default and the config bundle is where a "
    + "dense customer is set at onboarding");
  assert.equal(gridCellBudget(written), SAFE_GRID_CELLS, "an unset profile must read as the safe budget");
});

test("a project overlay's value survives the same way", async () => {
  const { service, dir, overlayCalls } = svc();
  mkdirSync(join(dir, "projects", "bulkmart"), { recursive: true });
  writeFileSync(join(dir, "projects", "bulkmart", "launch.json"),
    JSON.stringify({ projectName: "Launch", marketplaceDensity: "dense" }));

  const r = await service.route("POST", "/profiles/bulkmart/projects/launch/save", STAFF,
    { profile: { projectName: "Launch", defaultClasses: [9] } });
  assert.equal(r.status, 200, `overlay save failed: ${JSON.stringify(r.json)}`);
  assert.equal(overlayCalls.length, 1, "exactly one overlay write");
  assert.equal(overlayCalls[0].overlay.marketplaceDensity, "dense",
    "the project editor's save dropped the overlay's own density — the same strip, one door along");
});
