// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// Unit tests for the validator-replay harness (replay-archive.mjs) — discovery, replay verdicts,
// snapshot diff. Uses a temp-dir corpus; the real corpus (VM workspaces) is exercised manually.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { discoverRuns, replayRun, diffSnapshots } from "../replay-archive.mjs";

const MANIFEST = `# Variant manifest

## Variants — REPLAY MARK
| Variant | Category | Verify? |
|---|---|---|
| replaymark | exact-phrase | |

(padding so the manifest clears the validator's minimum length — variants table above is the
substance; this fixture mirrors the live prelim-variants shape closely enough for verify.mjs.)
`;

const cells = (variant, n) =>
  Array.from({ length: n }, (_, i) => `| ${variant} | platform-${i} | No results |`).join("\n");

const FINDINGS = (matrixBody) => `# Common-law findings — REPLAY MARK

## Findings
| Finding | Platform | URL |
|---|---|---|

### Negative results (per-platform per-variant)
| Variant | Platform | Result |
|---|---|---|
${matrixBody}

### Coverage ledger
| unit | status | reason |
|---|---|---|
| marketplace / all | confirmed-clean | full grid executed |

### Audit trail
| step | detail |
|---|---|
| grid | one batched call |
`;

function makeCorpus() {
  const root = mkdtempSync(join(tmpdir(), "replay-corpus-"));
  // live-slug run: complete receipts (7 cells) → commonLaw ok
  const clean = join(root, "tmp0001-replay-mark", "2026-06-12-test-clean");
  mkdirSync(clean, { recursive: true });
  writeFileSync(join(clean, "variant-manifest.md"), MANIFEST);
  writeFileSync(join(clean, "common-law-findings.md"), FINDINGS(cells("replaymark", 7)));
  writeFileSync(join(clean, "skeptic-flags.md"), "no flags surfaced\n");
  // archived run: short receipts (3 cells) → commonLaw fail:receipts_short
  const short = join(root, "archive", "2026-06", "tmp0002-replay-mark", "2026-06-11-test-short");
  mkdirSync(short, { recursive: true });
  writeFileSync(join(short, "variant-manifest.md"), MANIFEST);
  writeFileSync(join(short, "common-law-findings.md"), FINDINGS(cells("replaymark", 3)));
  // noise that must NOT be discovered
  mkdirSync(join(root, "queue"), { recursive: true });
  writeFileSync(join(root, "STATUS.md"), "not a run\n");
  return { root, clean, short };
}

test("discoverRuns: finds live-slug + archived runs, skips queue/STATUS noise", () => {
  const { root, clean, short } = makeCorpus();
  try {
    assert.deepEqual(discoverRuns([root]), [short, clean].sort());
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("replayRun: verdicts mirror the live validators (clean ok, short receipts fail)", () => {
  const { root, clean, short } = makeCorpus();
  try {
    const ok = replayRun(clean);
    assert.equal(ok.commonLaw, "ok");           // bare ok() (legacy prose path) — stays "ok"
    assert.equal(ok.variantManifest, "ok");     // bare ok() — stays "ok"
    assert.equal(ok.skepticFlags, "ok:clean");  // R.1 verdict-widening: skepticFlags returns ok("clean")
    const bad = replayRun(short);
    assert.match(bad.commonLaw, /^fail:receipts_short:replaymark:3\/7/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("diffSnapshots: flags verdict flips, reports new + gone runs, ignores unchanged", () => {
  const prev = { "/a": { commonLaw: "ok" }, "/gone": { commonLaw: "ok" } };
  const curr = { "/a": { commonLaw: "fail:receipts_short:x:1/7" }, "/new": { commonLaw: "ok" } };
  const d = diffSnapshots(prev, curr);
  assert.deepEqual(d.changed, [{ run: "/a", check: "commonLaw", was: "ok", now: "fail:receipts_short:x:1/7" }]);
  assert.deepEqual(d.added, ["/new"]);
  assert.deepEqual(d.removed, ["/gone"]);
  assert.deepEqual(diffSnapshots(prev, prev).changed, []);
});
