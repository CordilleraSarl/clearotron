// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// The CONFIG store's identity, beside the doctrine tree's.
//
// The doctrine tree has had a receipt since. The profile half had none, and that is the gap a day
// of rounds rode in on: the executing process held none of the store directories, every customer
// silently resolved to the bundled demo roster, and the scenario assert built to catch exactly that
// passed on every round — it checked the frozen framework was NON-EMPTY, and a bundled demo framework
// is non-empty. So the arms here are about what the receipt SAYS, not about what it refuses: nothing in
// it refuses anything, and a report that can kill a run is worse than no report.
//
// THE MODULE-LOAD SNAPSHOT IS THE SUBJECT, NOT AN ARTEFACT OF THE TEST. `profiles.mjs` captures
// CLEAROTRON_CUSTOMERS_DIR at import, so each situation needs its own freshly-imported module — a
// cache-busted specifier, the same device onboard.mjs uses. Sharing one import across these arms would
// test one situation four times and report four passes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let bust = 0;
/** Import profiles.mjs afresh with CLEAROTRON_CUSTOMERS_DIR set to `overlay` (or unset for null). */
async function freshProfiles(overlay) {
  const had = Object.prototype.hasOwnProperty.call(process.env, "CLEAROTRON_CUSTOMERS_DIR");
  const prev = process.env.CLEAROTRON_CUSTOMERS_DIR;
  if (overlay == null) delete process.env.CLEAROTRON_CUSTOMERS_DIR;
  else process.env.CLEAROTRON_CUSTOMERS_DIR = overlay;
  try {
    return await import(`../profiles.mjs?t=${++bust}`);
  } finally {
    if (had) process.env.CLEAROTRON_CUSTOMERS_DIR = prev;
    else delete process.env.CLEAROTRON_CUSTOMERS_DIR;
  }
}

test("unset — the bundled roster is a REPORTED state, not silence", async () => {
  const m = await freshProfiles(null);
  const r = m.profileStoreResolution({});
  assert.equal(r.situation, "bundled-fallback");
  assert.equal(r.outcome, "pass", "a house-defaults install is legitimate — the point is that it says so, not that it is refused");
  assert.match(r.detail, /CLEAROTRON_CUSTOMERS_DIR is unset/);
  assert.match(r.detail, /did not/, "it must name the misconfiguration this state is indistinguishable from");
});

test("configured — the store is named and it is the one in force", async () => {
  const dir = mkdtempSync(join(tmpdir(), "cust-"));
  try {
    const m = await freshProfiles(dir);
    const r = m.profileStoreResolution({ CLEAROTRON_CUSTOMERS_DIR: dir });
    assert.equal(r.situation, "overlay");
    assert.equal(r.outcome, "pass");
    assert.equal(r.store, dir);
    assert.deepEqual(r.findings, [], "a correctly configured store raises nothing");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("THE INCIDENT'S OWN SHAPE — set in the environment now, not in force", async () => {
  // The supervisor was started before the harness environment was exported. The variable reads as set
  // to anyone who looks at the environment afterwards, and the resolution is the bundled roster. That
  // pair is invisible without this arm, and it is exactly what nobody saw for a day.
  const m = await freshProfiles(null);
  const r = m.profileStoreResolution({ CLEAROTRON_CUSTOMERS_DIR: "/srv/config/profiles" });
  assert.equal(r.situation, "env-arrived-late");
  assert.equal(r.outcome, "blocked", "an environment that disagrees with the behaviour is not a pass");
  assert.deepEqual(r.findings, ["overlay_set_after_module_load"]);
  assert.match(r.detail, /was NOT set when profiles\.mjs loaded/);
});

test("configured, then the environment moved under it — reported without changing the answer", async () => {
  const dir = mkdtempSync(join(tmpdir(), "cust-"));
  try {
    const m = await freshProfiles(dir);
    const r = m.profileStoreResolution({ CLEAROTRON_CUSTOMERS_DIR: "/somewhere/else" });
    assert.equal(r.situation, "overlay");
    assert.equal(r.store, dir, "the store in force is the one captured at load, whatever the env says now");
    assert.deepEqual(r.findings, ["overlay_env_changed_since_load"]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("the receipt names every read root, so a layered store is legible", async () => {
  const dir = mkdtempSync(join(tmpdir(), "cust-"));
  try {
    const m = await freshProfiles(dir);
    const r = m.profileStoreResolution({ CLEAROTRON_CUSTOMERS_DIR: dir });
    assert.ok(Array.isArray(r.readRoots) && r.readRoots.length >= 2,
      "an overlay layers over the bundled set, and a receipt naming only the writable root hides the fallback underneath it");
    assert.equal(r.readRoots[0], dir, "overlay first — the order IS the precedence");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
