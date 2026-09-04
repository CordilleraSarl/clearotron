// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// The bundled demo roster is DERIVED from the directory that ships it, never written down beside it.
//
// It was a hand-maintained triple. driver/profiles/ grew a fourth client bundle, the triple did not,
// and the set-equality it feeds could no longer match anything — so the detector whose entire job is to
// notice a door that has silently fallen back to the bundled roster returned PASS on exactly that
// condition. A guard that cannot match anything reports that it found nothing wrong.
//
// The failure DIRECTION is the point. The same constant had produced two false refusals before, both
// from an exact match standing in for the property being protected; those failed closed, loudly, and
// someone investigated within the hour. This one failed open and would have shipped a deployment
// serving the demo roster while refusing every real client, with the check that exists to say so
// reporting a pass.

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { bundledDemoKeys, GENERIC_KEY } from "../bundled-demos.mjs";
import { rosterVerdict } from "../roster-verdict.mjs";

const REPO_PROFILES = new URL("../profiles/", import.meta.url).pathname;

const storeOf = (names) => {
  const d = mkdtempSync(join(tmpdir(), "bundled-demos-"));
  for (const n of names) writeFileSync(join(d, `${n}.json`), "{}\n");
  return d;
};

test("the keys come from the directory, so a bundle added to the tree is in the roster the same day", () => {
  const dir = storeOf([GENERIC_KEY, "zephyr", "aurora", "newcomer"]);
  assert.deepEqual(bundledDemoKeys({ profilesDir: dir }), ["aurora", "newcomer", "zephyr"],
    "a file present in the directory did not reach the derived roster — this is the staleness the "
    + "hand-maintained list had");
});

test("generic is excluded, because the door reports it separately and the two sides must mean the same thing", () => {
  const dir = storeOf([GENERIC_KEY, "zephyr"]);
  assert.deepEqual(bundledDemoKeys({ profilesDir: dir }), ["zephyr"]);
});

test("non-JSON neighbours are not keys — a context pack and a README are not customers", () => {
  const dir = storeOf([GENERIC_KEY, "petcary"]);
  writeFileSync(join(dir, "petcary.context.md"), "notes\n");
  writeFileSync(join(dir, "README.md"), "readme\n");
  mkdirSync(join(dir, "projects"));
  assert.deepEqual(bundledDemoKeys({ profilesDir: dir }), ["petcary"]);
});

// ── the failure direction, which is the whole defect ──────────────────────────────────────────────

test("an unreadable profiles directory THROWS — it never hands back an empty roster", () => {
  assert.throws(() => bundledDemoKeys({ profilesDir: join(tmpdir(), "no-such-dir-ever-abc123") }),
    /could not be read/,
    "an unreadable directory produced a roster instead of a refusal; an empty one matches nothing, and "
    + "matching nothing is how this check reported a pass on the condition it exists to catch");
});

test("a directory holding only generic THROWS rather than returning an empty roster", () => {
  assert.throws(() => bundledDemoKeys({ profilesDir: storeOf([GENERIC_KEY]) }), /ships no client bundles/);
});

// ── and the verdict it feeds, driven end to end ───────────────────────────────────────────────────

test("a door that resolved exactly the shipped roster is caught — the condition that read PASS", () => {
  const shipped = bundledDemoKeys({ profilesDir: REPO_PROFILES });
  assert.ok(shipped.length, "this repo ships no client bundles — the arm below would assert nothing");

  const { state, message } = rosterVerdict({
    keys: [...shipped], onDisk: null, bundledDemos: shipped, expectDemos: false,
  });
  assert.equal(state, "fail", "a door resolving the shipped roster with no configured store is the "
    + "silent-fallback condition, and it must be named rather than passed");
  assert.match(message, /not reaching the service/);
});

test("the same door reads PASS against a roster that has gone stale — the defect, reproduced", () => {
  // THE REGRESSION IN ONE ARM. Feed the verdict a roster missing one shipped bundle — which is exactly
  // what a hand-maintained list becomes the day the directory grows — and the set-equality can never
  // hold, so control reaches the final pass.
  const shipped = bundledDemoKeys({ profilesDir: REPO_PROFILES });
  assert.ok(shipped.length > 1, "need at least two shipped bundles to model a stale list");

  const { state } = rosterVerdict({
    keys: [...shipped], onDisk: null, bundledDemos: shipped.slice(0, -1), expectDemos: false,
  });
  assert.equal(state, "pass",
    "the stale-list defect no longer reproduces — if the verdict now catches this on its own, the "
    + "derivation may not be what is protecting us and this arm should be re-read rather than deleted");
});

test("the shipped directory and the derivation agree — no hand-maintained copy is left in the tree", () => {
  const onDisk = readdirSync(REPO_PROFILES).filter((f) => f.endsWith(".json"))
    .map((f) => f.slice(0, -".json".length)).filter((k) => k !== GENERIC_KEY).sort();
  assert.deepEqual(bundledDemoKeys({ profilesDir: REPO_PROFILES }), onDisk);
});
