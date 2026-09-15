// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// The runner's containment guard must recognise a temp root on a box whose temp directory is not /tmp.
//
// WHY THIS ARM EXISTS AND WHY IT IS SHAPED LIKE THIS. Ten arms in test-run-tmpdir.test.mjs already drive
// the nesting this protects, and on a box exporting TMPDIR=/mnt/datadisk1/tmp they failed for a year's
// worth of reasons that were never the code's. They pass in CI — and MEASURED, they pass in CI whether
// the fix is present or absent, because CI leaves TMPDIR unset, every run root lands under /tmp, and the
// literal "/tmp" in the containment list covers the sibling by accident.
//
// So those ten cannot guard this. An arm that only fails on one box is not a guard; it is a report about
// that box. This one removes the accident: it names a temp root that is NOT under the ambient temp
// directory and NOT under /tmp, so the literal cannot cover it and only the machine-temp-root rule can.
// It therefore fails in CI, on this box, and on any box, if the rule is removed.
//
// IT DRIVES THE REAL ENTRY POINT rather than a copy of the decision. The runner is a CLI script with no
// exports and a top-to-bottom body, so there is nothing to import; asserting on a re-implementation of
// `isContained` would be a second author of the rule, which is the defect this repository keeps finding.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const RUNNER = resolve(fileURLToPath(new URL("../../scripts/test-run.mjs", import.meta.url)));
const REPO = dirname(dirname(RUNNER));

/** Run the runner over a script that does nothing, and hand back what a caller would see. */
function drive(env) {
  const dir = mkdtempSync(join(env.CT_TEST_MACHINE_TMP ?? REPO, "drive-"));
  const script = join(dir, "noop.mjs");
  writeFileSync(script, "process.exit(0);\n");
  // REFUSED MEANS THE CONTAINMENT GUARD REFUSED, not "exited non-zero". The first version of this helper
  // read any failure as a refusal, and a run that failed for an unrelated reason then read as the very
  // thing this file is about — a verdict about something other than its subject, which is the family of
  // defect that produced the issue underneath it.
  let out = "";
  try {
    out = execFileSync("node", [RUNNER, "node", script], { encoding: "utf8", env, stdio: "pipe" });
  } catch (e) {
    out = String(e.stdout ?? "") + String(e.stderr ?? "");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  return { refused: /REFUSING TO RUN/.test(out), out };
}

test("a temp root that is neither the ambient tmpdir nor /tmp is still a temp root", () => {
  // THE FIXTURE IS DELIBERATELY NOT UNDER /tmp. Put it there and this arm passes on a reverted fix,
  // which is exactly how the defect reached a box in the first place.
  const base = join(REPO, ".tmp-containment-fixture");
  mkdirSync(base, { recursive: true });
  try {
    const dataPlane = join(base, "run-root", "queue");
    mkdirSync(dataPlane, { recursive: true });

    // The nested shape, without needing a nested run: TMPDIR names a run root the way a parent runner
    // hands one down, and the data plane points at a SIBLING under the machine's own temp root.
    const env = {
      ...process.env,
      TMPDIR: join(base, "some-other-run-root"),
      CT_TEST_MACHINE_TMP: base,
      CLEAROTRON_QUEUE_DIR: dataPlane,
    };
    delete env.CT_TEST_TMP_BASE;
    mkdirSync(env.TMPDIR, { recursive: true });

    const r = drive(env);
    assert.equal(r.refused, false,
      "a value under the machine's own temp root was refused as a live data plane. The containment list "
      + `is covering only the ambient tmpdir and the literal /tmp:\n${r.out.slice(0, 600)}`);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("and a value genuinely outside every temp root is STILL refused", () => {
  // The other half, and the one that makes the first mean something. Widening a containment list until
  // nothing is refused reads exactly like fixing it — this is the arm that tells those apart. The value
  // below is the shape the guard exists for: somebody's live estate, under a home directory.
  const base = join(REPO, ".tmp-containment-fixture-2");
  mkdirSync(base, { recursive: true });
  try {
    const env = {
      ...process.env,
      TMPDIR: base,
      CT_TEST_MACHINE_TMP: base,
      CLEAROTRON_QUEUE_DIR: join(REPO, "not-a-temp-root", "queue"),
    };
    delete env.CT_TEST_TMP_BASE;
    delete env.CT_ALLOW_LIVE_DATA_PLANE;
    const r = drive(env);
    assert.equal(r.refused, true, "a data plane outside every temp root was accepted — the guard is now a no-op");
    assert.match(r.out, /REFUSING TO RUN/, "it failed for some other reason than the containment guard");
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});
