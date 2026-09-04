// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// — DOCTOR NAMED THE STORE AND NOT WHO WAS IN IT.
//
// An operator who has just configured a customers directory wants one thing confirmed: that their
// overlay took effect. A path does not answer that. `brandowner add` even ends by
// telling them "doctor will now resolve <key> from <store>" — a sentence doctor could not confirm.
//
// DRIVEN AS THE COMMAND, not as the module behind it, for the reason the doctrine-overlay arm beside
// this one gives: a report that exists and is not wired passes every module-level check and delivers
// nothing to the person typing. These spawn `clearotron doctor`.
//
// THE ARM THAT MATTERS MOST IS THE BROKEN ROSTER. loadProfiles throws for the WHOLE roster when two
// brand owners claim one domain, so the state that most needs reporting is precisely the one that
// produces no list — and "no brand owners resolve here" would be a confident wrong answer about a
// deployment whose every customer resolution is failing.

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { pinEnv } from "../../shared/env-aliases.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** A customers store on disk. `generic` is required by the loader, so every fixture has one. */
function store(profiles = {}, projects = {}) {
  const dir = mkdtempSync(join(tmpdir(), "doctor-store-"));
  writeFileSync(join(dir, "generic.json"), JSON.stringify({ name: "House default", platforms: ["amazon.com"] }));
  for (const [key, p] of Object.entries(profiles)) writeFileSync(join(dir, `${key}.json`), JSON.stringify(p));
  for (const [customer, overlays] of Object.entries(projects)) {
    mkdirSync(join(dir, "projects", customer), { recursive: true });
    for (const [name, o] of Object.entries(overlays)) {
      writeFileSync(join(dir, "projects", customer, `${name}.json`), JSON.stringify(o));
    }
  }
  return dir;
}

/** Drive the command a user types. The variable NAME goes to pinEnv as an argument, not as an object
 *  key, for the reason the doctrine-overlay arm records: written as a key it reads to the one-spelling
 *  guard as a real pin. */
function doctorOver(dir) {
  const e = { ...process.env };
  pinEnv(e, "CLEAROTRON_CUSTOMERS_DIR", dir);
  const r = spawnSync(process.execPath, [join(ROOT, "bin", "clearotron.mjs"), "doctor"],
    { cwd: ROOT, env: e, encoding: "utf8" });
  // 2064 — the spawn's own fate before its text means anything: a child that never came back returns
  // empty output, and every assert downstream then fires with a message about the SUBJECT. Exit status
  // stays part of the verdict (this child says no by exiting non-zero); error/signal never is.
  if (r.error || r.signal) throw new Error(`the child did not come back (signal=${r.signal} error=${r.error?.message}) — a could-not-look, not a verdict`);
  return `${r.stdout ?? ""}${r.stderr ?? ""}`;
}

test("1911 doctor names the brand owners that actually resolved", () => {
  const dir = store({
    northwind: { name: "Northwind Trading SA", platforms: ["amazon.com"] },
    calder: { name: "Calder Instruments", platforms: ["amazon.com"] },
  });
  const out = doctorOver(dir);
  assert.match(out, /2 brand owner\(s\) resolve here/);
  assert.match(out, /northwind/, "an operator confirms their own overlay took effect by seeing their key");
  assert.match(out, /calder/);
});

test("1911 doctor names the projects too, under their brand owner", () => {
  const dir = store(
    { northwind: { name: "Northwind Trading SA", platforms: ["amazon.com"] } },
    { northwind: { "japan-launch": { platforms: ["amazon.co.jp"] } } });
  const out = doctorOver(dir);
  assert.match(out, /1 project\(s\)/);
  assert.match(out, /northwind\/japan-launch/, "qualified by its brand owner — a bare project name names nothing");
  assert.doesNotMatch(out, /undefined/, "the project's key comes from the loader's own field, never a dead fallback");
});

test("1911 AN EMPTY STORE SAYS SO, and says what else it could mean", () => {
  // `generic` is the fallback the loader requires by name, not a brand owner anybody onboarded.
  // Counting it would tell an operator with an empty store that they have one.
  const out = doctorOver(store());
  assert.match(out, /no brand owners resolve here/);
  assert.match(out, /generic/, "names what IS there, so the line is not mistaken for a broken read");
  assert.match(out, /wrong directory/i,
    "an empty store and a store pointed somewhere wrong look identical — the operator is told that");
});

test("1911 a DEMO account is marked, because a real clearance under one is refused", () => {
  const dir = store({ pretend: { name: "Pretend Co", platforms: ["amazon.com"], demoData: true } });
  const out = doctorOver(dir);
  assert.match(out, /pretend \(DEMO DATA\)/);
  assert.match(out, /cannot start a real clearance/,
    "the consequence, not just the label — an operator should learn it here, not from the refusal");
});

test("1911 A ROSTER THAT WILL NOT LOAD IS A FINDING, NEVER AN EMPTY LIST", () => {
  // Two brand owners claiming one domain. The loader throws for the WHOLE roster, so every customer
  // resolution on this deployment is failing — and the naive report of that state is "no brand owners",
  // which reads as a working install with nothing in it.
  const dir = store({
    northwind: { name: "Northwind Trading SA", platforms: ["amazon.com"], matchDomains: ["shared.test"] },
    calder: { name: "Calder Instruments", platforms: ["amazon.com"], matchDomains: ["shared.test"] },
  });
  const out = doctorOver(dir);
  assert.match(out, /the roster did not load/);
  assert.match(out, /not an empty store/, "the distinction stated where the reader is");
  assert.doesNotMatch(out, /no brand owners resolve here/,
    "the empty-store sentence must not appear for a roster that refused to load");
});
