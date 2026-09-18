// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// the-preview-refuses-what-the-claim-refuses.test.mjs — with a company file unreadable, the free preview of
// an order that names no company answers as the claim does.
//
// THE DEFECT. The roster loader now leaves an unreadable company out and names it, and the claim refuses an
// order that names no company while one is unread: its domains are unknown, so rating it under `generic`
// could be rating another company's search under the wrong settings. The preview swallowed that refusal and
// answered wouldRun:true, no blockers. Nothing wrong was delivered — the claim held — but the free door
// promised a run the queue refuses.
//
// Its own file because profiles.mjs reads CLEAROTRON_CUSTOMERS_DIR at module load: the store must be set
// before anything imports it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { pinEnv } from "../../shared/env-aliases.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const GENERIC = JSON.parse(readFileSync(join(ROOT, "driver", "profiles", "generic.json"), "utf8"));
const store = mkdtempSync(join(tmpdir(), "preview-claim-"));
writeFileSync(join(store, "generic.json"), JSON.stringify(GENERIC));
writeFileSync(join(store, "invented.json"), JSON.stringify({ ...GENERIC, name: "Invented Co", matchDomains: ["invented.example"] }));
pinEnv(process.env, "CLEAROTRON_CUSTOMERS_DIR", store);

const { planRun } = await import("../lib/plan.mjs");
const { resolveProfile, loadProfiles } = await import("../../driver/profiles.mjs");

const ORDER = { markName: "INVENTED MARK", product: "knockout-search", classes: [9], forwarder: "staff-a" };
const claimRefusal = () => {
  try { resolveProfile({ markName: ORDER.markName }, { profiles: loadProfiles({ force: true }) }); return null; }
  catch (e) { return e.code ?? String(e.message); }
};

test("every company readable: the unkeyed preview runs, and so does the claim", () => {
  loadProfiles({ force: true });
  const p = planRun(ORDER);
  assert.equal(claimRefusal(), null);
  assert.ok(!p.blockers.some((b) => /profile_roster_incomplete/.test(b)), "no roster blocker on a whole roster");
});

test("a company file unreadable: the preview refuses in the claim's own words, as the claim does", () => {
  writeFileSync(join(store, "wrecked.json"), JSON.stringify({ name: "Wrecked Co", matchDomains: ["wrecked.example"], platforms: [] }));
  try {
    loadProfiles({ force: true });
    const p = planRun(ORDER);
    assert.equal(claimRefusal(), "profile_roster_incomplete", "the claim refuses the unkeyed order");
    assert.equal(p.wouldRun, false, "and the free preview no longer promises it would run");
    assert.ok(p.blockers.some((b) => /profile_roster_incomplete/.test(b) && /wrecked\.json/.test(b)),
      "the blocker is the claim's own reason, naming the file");
    // A keyed order for a readable company is untouched by another company's file.
    const keyed = planRun({ ...ORDER, profileKey: "invented" });
    assert.ok(!keyed.blockers.some((b) => /profile_roster_incomplete/.test(b)));
  } finally { rmSync(join(store, "wrecked.json"), { force: true }); loadProfiles({ force: true }); }
});

test.after(() => rmSync(store, { recursive: true, force: true }));
