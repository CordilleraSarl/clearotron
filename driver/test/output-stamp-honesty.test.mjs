// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// No `output:` field anywhere in the driver is built from the FORGIVING file helper.
//
// ── WHY A SOURCE-LEVEL GUARD AND NOT ANOTHER ROW ASSERTION ───────────────────────────────────────
//
// There are two helpers and the difference is the whole point (driver/log.mjs):
//
//   fileMeta(p)   → {sha:null, size:0} when the path is absent. Right for an INPUT fingerprint:
//                   absent-then-present is a legitimate change a freshness stamp must see.
//   outputMeta(p) → {present:false, sha:null, size:null} when absent. Right for an OUTPUT: a stage
//                   that emitted nothing must not journal a plausible zero-size record, and nothing
//                   may claim a byte count nobody measured. A real 0-byte file is present:true,size:0.
//
// found `output: ok ? fileMeta(out): undefined` on the code-side direct-execute lane's
// per-attempt row — four lines above a comment specifying unconditional outputMeta, and in the same
// function whose run.jsonl sink already used it. Half the described fix had landed; the half that
// mattered had not.
//
// mcp-server/test/babysit-output-honesty.test.mjs already asserts this contract, but it projects
// `get_run stages`, which is built from run.jsonl. The row found goes to the per-attempt
// `<stage>.jsonl` — a different surface, which nothing was asserting. Adding a fixture row for that
// one surface would fix this instance and leave the next one to be found the same way.
//
// So this reads the SOURCE. It is the only form that covers a writer nobody has thought of yet:
// every `output:` key, present and future, on every surface. A guard that enumerates known rows can
// only ever be as complete as the last audit.
//
// ── WHAT IT DELIBERATELY DOES NOT DO ─────────────────────────────────────────────────────────────
//
// It does not police `fileMeta` itself — that helper is correct and has six legitimate callers in
// pipeline.mjs alone (input fingerprints, sandbox stamps). It bans exactly one pairing: the forgiving
// helper feeding a field named `output`.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { trackedFiles as trackedCorpus, skipReason } from "../../shared/tracked-files.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const BANNED = /\boutput:\s*[^,}]*\bfileMeta\s*\(/;

// THE CORPUS COMES FROM THE HELPER, never from a raw `git ls-files`. test-tiers.test.mjs forbids the
// raw form and caught this file on its first full run — fairly. Off a source zip with no checkout, a
// raw enumeration returns nothing and every assertion below passes over an empty list: a guard about
// honest absence, silently absent itself. The helper turns that into a STATED skip plus the
// [repo-guard] markers CI asserts in both directions.
const GUARD = "output-stamp-honesty (no output: built from fileMeta)";
const sources = () => {
  const all = trackedCorpus(GUARD, { root: ROOT, pathspec: ["driver", "mcp-server", "shared"] });
  return all === null ? null : all.filter((f) => f.endsWith(".mjs") && !f.includes("/test/"));
};

test("#911 no `output:` field is built from the forgiving fileMeta", (t) => {
  const files = sources();
  if (files === null) return t.skip(skipReason(GUARD));
  const offenders = [];
  for (const f of files) {
    const text = readFileSync(join(ROOT, f), "utf8");
    text.split("\n").forEach((line, i) => {
      if (line.trim().startsWith("//") || line.trim().startsWith("*")) return;   // comments explain, never write
      if (BANNED.test(line)) offenders.push(`${f}:${i + 1}  ${line.trim()}`);
    });
  }
  assert.deepEqual(offenders, [],
    "an output stamped with fileMeta renders a missing or mid-write artifact as {sha:null,size:0} — a "
    + "record where there is no file. Use outputMeta, which says {present:false}:\n  "
    + offenders.join("\n  "));
});

test("#911 the guard can actually see the tree it claims to check", (t) => {
  // The assertion above passes just as well over an empty file list, which is the failure this round
  // kept finding: a check that stopped looking reads identically to one that found nothing.
  const files = sources();
  if (files === null) return t.skip(skipReason(GUARD));
  assert.ok(files.length > 100, `expected the driver corpus, enumerated ${files.length} file(s)`);
  assert.ok(files.includes("driver/pipeline.mjs"), "pipeline.mjs is in scope — it is where #911 was");
  assert.ok(files.some((f) => f.startsWith("mcp-server/")), "the mcp-server writers are in scope too");
});

test("#911 the pattern it bans is the pattern that was actually there", () => {
  // Pinned to the literal offending line from pipeline.mjs before the fix, so the regex answers to a
  // real defect rather than to my idea of one. Loosen the pattern later and this fails.
  assert.match("    output: ok ? fileMeta(out) : undefined,", BANNED,
    "the shape #911 found must still be caught");
  // …and the honest form must NOT be caught, or the guard would ban the fix it exists to require.
  assert.doesNotMatch("    output: outputMeta(out),", BANNED);
  // An input fingerprint keeps fileMeta and must be left alone.
  assert.doesNotMatch("      const meta = fileMeta(inSandbox);", BANNED);
});
