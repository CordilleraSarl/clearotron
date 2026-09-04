// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// feedback-store.test.mjs — the flag store.
//
// The property under test is not "it writes a file". It is that a flag stays READABLE AS EVIDENCE after
// the run it describes has been republished, which is what the composite locator exists for and what the
// predecessor system's bare ordinal did not survive.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendFlag, listFlags, feedbackDir, MAX_WHY, VERDICTS } from "../feedback-store.mjs";

const dir = () => mkdtempSync(join(tmpdir(), "fb-"));
const FULL = {
  runId: "noref000036-petcary-2026-08-04-fixture",
  verdict: "bad",
  why: "The citation does not show use of the cited mark on these goods.",
  capturedBy: "lawyer@example.test",
  locator: { ordinal: 3, mark: "KURENA", band: "Manageable", disposition: "rebuttable", section: "03 Notable but manageable" },
  excerpt: "Distinguished as wholes on the filed goods.",
  run: { account: "petcary", matter: "m", markName: "VENZY", product: "global-preliminary-search", issuedAt: "2026-08-04T06:54:58.017Z", engineCommit: "abc123", runDir: "/pool/x" },
};

test("a flag records WHERE it was raised in four ways, not one — the ordinal cannot be the only handle", () => {
  const d = dir();
  const { id, path } = appendFlag(d, FULL);
  const rec = JSON.parse(readFileSync(path, "utf8"));
  assert.equal(rec.id, id);
  assert.equal(rec.schema, "report-feedback/1");
  // The ordinal is renumbered contiguously on EVERY publish (findings-model.mjs), so on its own it
  // silently re-points. These three are what let a reader tell a moved finding from the right one.
  assert.deepEqual(rec.locator, {
    ordinal: 3, ref: null, searchedMark: null, mark: "KURENA", band: "Manageable", disposition: "rebuttable",
    section: "03 Notable but manageable",
  });
  assert.equal(rec.excerpt, "Distinguished as wholes on the filed goods.");
  assert.equal(rec.run.engineCommit, "abc123", "which BUILD produced the finding — the join to a diff");
  assert.equal(rec.run.runDir, "/pool/x");
  assert.equal(rec.verdict, "bad");
  assert.equal(rec.capturedBy, "lawyer@example.test");
  assert.match(rec.capturedAt, /^\d{4}-\d{2}-\d{2}T/);
  rmSync(d, { recursive: true, force: true });
});

test("good flags are first-class: both verdicts write the same record shape", () => {
  const d = dir();
  assert.deepEqual([...VERDICTS].sort(), ["bad", "good"]);
  const good = JSON.parse(readFileSync(appendFlag(d, { ...FULL, verdict: "good", why: "Exactly right — this is the one that matters." }).path, "utf8"));
  const bad = JSON.parse(readFileSync(appendFlag(d, FULL).path, "utf8"));
  assert.deepEqual(Object.keys(good).sort(), Object.keys(bad).sort(), "one shape, whichever way the reader felt");
  assert.equal(good.verdict, "good");
  rmSync(d, { recursive: true, force: true });
});

test("a flag with no reason, no run or an unknown verdict is REFUSED — an unusable flag looks like evidence", () => {
  const d = dir();
  assert.throws(() => appendFlag(d, { ...FULL, why: "   " }), /why is required/);
  assert.throws(() => appendFlag(d, { ...FULL, why: undefined }), /why is required/);
  assert.throws(() => appendFlag(d, { ...FULL, runId: "" }), /runId is required/);
  assert.throws(() => appendFlag(d, { ...FULL, verdict: "meh" }), /verdict must be good or bad/);
  assert.throws(() => appendFlag(d, { ...FULL, verdict: undefined }), /verdict must be good or bad/);
  assert.throws(() => appendFlag(d, { ...FULL, why: "x".repeat(MAX_WHY + 1) }), /over the 4000 limit/);
  assert.deepEqual(listFlags(d), [], "nothing was written by any of them");
  rmSync(d, { recursive: true, force: true });
});

test("a missing locator is stored as null rather than dropped — a flag on a run with no report-data still says so", () => {
  const d = dir();
  const rec = JSON.parse(readFileSync(appendFlag(d, { runId: "r", verdict: "bad", why: "wrong" }).path, "utf8"));
  assert.deepEqual(rec.locator, { ordinal: null, ref: null, searchedMark: null, mark: null, band: null, disposition: null, section: null });
  assert.equal(rec.excerpt, null);
  assert.equal(rec.run.engineCommit, null);
  rmSync(d, { recursive: true, force: true });
});

test("listFlags is newest-first and SKIPS a corrupt file — one bad record must not lose the others", () => {
  const d = dir();
  appendFlag(d, { ...FULL, capturedAt: "2026-08-01T00:00:00Z", why: "older" });
  appendFlag(d, { ...FULL, capturedAt: "2026-08-03T00:00:00Z", why: "newer" });
  writeFileSync(join(d, "not-json.json"), "{ half a fi");
  const rows = listFlags(d);
  assert.deepEqual(rows.map((r) => r.why), ["newer", "older"]);
  assert.deepEqual(listFlags(join(d, "nope")), [], "a missing directory reads as empty, never a throw");
  rmSync(d, { recursive: true, force: true });
});

test("the store is group-readable but not world-readable, and lives BESIDE the pool, not inside a run", () => {
  const d = dir();
  const { path } = appendFlag(d, FULL);
  assert.equal(statSync(path).mode & 0o777, 0o640);
  // Run directories are written read-only at publish and purged on their own schedule; a flag outliving
  // the run it describes is the point of keeping it out of them.
  assert.equal(feedbackDir("/pool"), join("/pool", "_feedback"));
  const prev = process.env.CLEAROTRON_FEEDBACK_DIR;
  process.env.CLEAROTRON_FEEDBACK_DIR = "/elsewhere/flags";
  assert.equal(feedbackDir("/pool"), "/elsewhere/flags", "deployable off the pool root");
  if (prev === undefined) delete process.env.CLEAROTRON_FEEDBACK_DIR; else process.env.CLEAROTRON_FEEDBACK_DIR = prev;
  rmSync(d, { recursive: true, force: true });
});
