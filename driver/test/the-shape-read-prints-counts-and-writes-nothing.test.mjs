// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readdirSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { planShape } from "../../scripts/register-plan-shape.mjs";

const ROOT = join(dirname(dirname(fileURLToPath(import.meta.url))), "..");
const SCRIPT = join(ROOT, "scripts", "register-plan-shape.mjs");
const MARK = "VELTRIS";

// ── A TOOL POINTED AT A RECORDED CLIENT RUN OWES TWO GUARANTEES ────────────────────────────────────
//
// It prints ARITHMETIC AND NOTHING ELSE, because the mark, the goods words, the owners and the records
// are not ours to quote anywhere — and a plan entry's qid contains the mark, so an identifier list
// would be a disclosure too. And it WRITES NOTHING, because a recorded run is evidence and the
// ordinary compile path freezes the plan it builds.
//
// Both are asserted by driving the real script over a run directory, rather than read off its source.

function runDirWith(t, { scope, manifest } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "shape-read-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, "_driver"), { recursive: true });
  writeFileSync(join(dir, "variant-manifest.json"), JSON.stringify(manifest ?? {
    schema_version: 1, mark: MARK, dominant_element: MARK,
    elements: [{ value: MARK, kind: "distinctive" }],
    variants: [{ value: MARK, category: "core" }, { value: "VELTRISS", category: "visual" },
      { value: "WELTRIS", category: "phonetic" }, { value: "ヴェルトリス", category: "transliteration" }],
    incumbent_classes: ["9"], goods_words: ["software", "platform"],
  }));
  writeFileSync(join(dir, "_driver", "instructed-scope.json"), JSON.stringify(scope ?? {
    marks: [MARK], classes: [9, 42], jurisdictions: ["US", "EU"], goods: "software",
    customer: null, geography: { mode: "instructed", origin: "request" },
  }));
  writeFileSync(join(dir, "_driver", "profile.json"), JSON.stringify({ defaultClasses: [], selfExclusionOwners: [] }));
  return dir;
}

const snapshot = (dir) => readdirSync(dir, { recursive: true, withFileTypes: true })
  .filter((d) => d.isFile())
  .map((d) => {
    const p = join(d.parentPath ?? d.path, d.name);
    return `${p}:${statSync(p).size}:${readFileSync(p, "utf8")}`;
  }).sort().join("\n");

const run = (dir, env = {}) => execFileSync(process.execPath, [SCRIPT, dir],
  { encoding: "utf8", env: { ...process.env, ...env } });

test("it leaves the run directory byte-identical", (t) => {
  // THE ONE THAT MATTERS ON A REAL RUN. The ordinary compile path writes the plan it built and adds
  // run-journal rows; a measuring tool that did either would alter the evidence it was pointed at.
  const dir = runDirWith(t);
  const before = snapshot(dir);
  run(dir, { CLEAROTRON_DATABASE: "clarivate" });
  assert.equal(snapshot(dir), before, "the shape read changed the run directory it was pointed at");
});

test("it prints counts, and no term, mark or identifier", (t) => {
  const dir = runDirWith(t);
  const out = run(dir, { CLEAROTRON_DATABASE: "clarivate" });
  assert.match(out, /questions compiled\s+\d+/, "the count line is missing");
  assert.match(out, /waiting for the reading turn\s+\d+/, "the waiting count is missing");
  // THE MARK IN EVERY FORM IT REACHES THE PLAN IN. A qid is `axis:predicate:<mark>`, so printing one
  // would carry the mark out with it — which is the whole reason this prints counts.
  for (const leak of [MARK, MARK.toLowerCase(), "VELTRISS", "WELTRIS", "ヴェルトリス", "software", "platform"]) {
    assert.ok(!out.includes(leak), `the shape read printed "${leak}" — that is client matter`);
  }
  assert.ok(!/:exact:|:default:/.test(out), "the shape read printed a qid, which carries the mark");
});

test("the frozen-plan comparison prints counts, and leaks nothing out of the frozen artifact", (t) => {
  // THE FROZEN PLAN IS FULL OF THE MARK — every qid is `axis:predicate:<mark>`. This comparison reads
  // that artifact, so it is the one read most able to carry client matter out, and the arm plants a
  // mark-bearing qid to prove it does not.
  const dir = runDirWith(t);
  writeFileSync(join(dir, "_driver", "register-plan.json"), JSON.stringify({
    plan_version: 1, nice_classes: ["9"], regions: [], entries: [
      { qid: `primary-sweep:exact:${MARK.toLowerCase()}`, axis: "primary-sweep", predicate: "exact", provenance: "mark" },
      { qid: `incumbent-class:owner:secretowner`, axis: "incumbent-class", predicate: "owner", provenance: "model" },
    ],
  }));
  const out = run(dir, { CLEAROTRON_DATABASE: "clarivate" });
  assert.match(out, /questions frozen\s+2/, "the frozen plan was not read, so the comparison proves nothing");
  assert.match(out, /incumbent-class/, "the per-axis comparison is missing — that is the diagnostic");
  for (const leak of [MARK, MARK.toLowerCase(), "secretowner"]) {
    assert.ok(!out.includes(leak), `the frozen comparison printed "${leak}" out of the frozen plan`);
  }
  assert.ok(!/:exact:|:owner:/.test(out), "a qid from the frozen plan reached the output");
});

test("an absent input is a refusal that names what it looked for, not a zero", (t) => {
  // A compile over a half-read run directory produces a number, and a number produced that way is
  // worse than no number: it reads exactly like a measurement.
  const dir = runDirWith(t);
  rmSync(join(dir, "variant-manifest.json"));
  let code = 0, stderr = "";
  try { run(dir, { CLEAROTRON_DATABASE: "clarivate" }); }
  catch (e) { code = e.status; stderr = String(e.stderr ?? ""); }
  assert.equal(code, 2, "a missing input did not stop the read");
  assert.match(stderr, /variant manifest/, "the refusal does not name the input it wanted");
  assert.match(stderr, /variant-manifest\.json/, "the refusal does not name the path it looked at");
});

test("the verdict follows the plan, in both directions", () => {
  // planShape is the thing the verdict line is derived from, so it is driven directly over both
  // answers rather than only over the plan the compiler currently produces.
  const held = planShape({ entries: [
    { axis: "primary-sweep", predicate: "exact", provenance: "mark" },
    { axis: "saturation-probe", predicate: "default" },
    { axis: "primary-sweep", predicate: "default", provenance: "mark", goods_text: ["software"] },
    { axis: "primary-sweep", predicate: "exact", provenance: "model", when: { awaits_reading_turn: true } },
  ] });
  assert.deepEqual(held.unexpected, [], "a correct plan was reported as not holding the rule");
  assert.equal(held.open, 3);
  assert.equal(held.waiting, 1);

  // The bare contains entry on the mark is NOT one of the open kinds — only the goods-narrowed one is.
  // An entry like this running unasked is the defect ruling 204 names, and it must be reported.
  const broken = planShape({ entries: [
    { axis: "primary-sweep", predicate: "default", provenance: "mark" },
  ] });
  assert.deepEqual(broken.unexpected, ["primary-sweep/default"],
    "a bare contains entry running unasked was counted as sanctioned");
});
