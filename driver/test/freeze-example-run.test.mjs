// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// scripts/freeze-example-run.mjs — the capture tool for the frozen demo sample.
//
// These tests stand on a SYNTHETIC run workspace, not on a real one. The real sample capture is blocked
// on production register credentials, and the thing under test is structural anyway: does the allowlist
// carry what publish reads, does the prune actually drop the payloads, does the scrub battery FIRE, and
// does the republish proof notice when the allowlist loses an input. A tool whose failure path is never
// exercised is a tool that reports success it did not earn.
import { test } from "node:test";
import { pinEnvAll } from "../../shared/env-aliases.mjs";   // — a spread carries EVERY spelling, so an override must clear every spelling
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";   //
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, "..", "..", "scripts", "freeze-example-run.mjs");

const REPORT_MD = `---
type: prelim-clearance
matter: TMP8439
title: PROJECT AQUAPLUS
client: Zephyr Beverages
use: codename
classes: 9, 41
run: 2026-01-01 · euipo + common-law
overall_label: Low
overall_badge: l2
overall_caption: synthetic fixture
coverage_line: Classes 9 and 41: searched · registers: EU
rated_under: House default · house default framework
---

# Actions
### Checks we ran — what we found
- Synthetic use-check: none found ([src](https://x.example)).

# Coverage
Synthetic coverage panel.

# Methodology
Synthetic methodology paragraph.

# Marks

## Example Holdings BV — PROJECT AQUAPLUS, EU
- ord: 1
- open: false
- net: Synthetic net line for the fixture.
- tier: 1
- label: Level A · Composite 1 · Clear
- group: off-field
- source: Register
### Full detail
- Synthetic filing detail.
- Source: [Provider · card1](#)

# Reasoned negatives

None.
`;

// One real finding, not an empty array: an empty contract renders almost the same with or without the
// file, so a holed allowlist would slip past the proof on the very fixture meant to catch it.
const FINDINGS = {
  schema_version: 7,
  rated_under_framework: "house-default",
  findings: [{
    ordinal: 1,
    mark: "PROJECT AQUAPLUS",
    owner: { name: "Example Holdings BV", country: "NL", registrations: [{ uri: "/mark/eu/000123456", classes: ["9"], status: "Registered", filed: "2020-01-01", expiry: "2030-01-01", jurisdiction: "EU" }] },
    band: "Low",
    disposition: "adversarial",
    legal_position: "Synthetic legal position for the fixture.",
    practical_position: "Synthetic practical position for the fixture.",
    net: "Synthetic net line for the fixture.",
    meters: {
      mark_similarity: { token: "low", basis: "inferred-from-signal" },
      goods_proximity: { token: "low", basis: "inferred-from-signal" },
      use: { token: "not-confirmed", basis: "inferred-from-signal" },
      enforcer: { token: "low", basis: "inferred-from-signal" },
    },
    quadrant: { x: 0.2, y: 0.2 },
    source: { source_type: "register-vendor", resolved_link: "https://tm.example/mark/eu/000123456" },
  }],
  coverage: [{ area: "register / EU", state: "confirmed-clean", note: "" }],
  actions: [],
};

/** A run workspace laid out the way the archive lays one out: …/<matter>/<date>-<codename>. */
function makeRun({ payloads = true, records = 0, plant = null } = {}) {
  const root = mkdtempSync(join(tmpdir(), "freeze-src-"));
  const runDir = join(root, "archive", "2026-01", "tmp8439-aquaplus", "2026-01-01-synthetic-fixture");
  mkdirSync(driverDir(runDir, "stage-inputs"), { recursive: true });
  writeFileSync(join(runDir, "report.md"), REPORT_MD);
  writeFileSync(join(runDir, "findings.json"), JSON.stringify(FINDINGS, null, 2));
  writeFileSync(join(runDir, "status.json"), JSON.stringify({ markName: "AQUAPLUS" }, null, 2));
  writeFileSync(join(runDir, "audit.md"), "---\n---\n\n# Findings\n\n# Negative Results\n\n# Audit Trail\n");
  writeFileSync(join(runDir, ".delivered"), "ok\n");
  writeFileSync(driverDir(runDir, "profile.json"), JSON.stringify({ profileKey: "generic" }, null, 2));
  writeFileSync(driverDir(runDir, "verdict.json"), JSON.stringify({ tier: "l2", verdict: "CLEAR" }, null, 2));
  if (payloads) {
    // The things the freeze exists to leave behind.
    writeFileSync(driverDir(runDir, "run.jsonl"), '{"event":"stage"}\n');
    writeFileSync(driverDir(runDir, "synthesis.jsonl"), '{"model":"anthropic/claude-opus-5","usage":{"input":10,"output":20}}\n');
    writeFileSync(driverDir(runDir, "synthesis.attempt1.dispatch.txt"), "the prompt sent to the model\n");
    writeFileSync(driverDir(runDir, "stage-inputs", "synthesis.json"), "{}\n");
  }
  for (let i = 0; i < records; i++) {
    mkdirSync(join(runDir, "_records"), { recursive: true });
    writeFileSync(join(runDir, "_records", `eu-0000000${i}.json`), JSON.stringify({ uri: `/mark/EM50000000${i}`, mark: "AQUAPLUS" }, null, 2));
  }
  if (plant) writeFileSync(join(runDir, plant.file), plant.text);
  return { root, runDir };
}

function runFreeze(runDir, out, extra = []) {
  try {
    const stdout = execFileSync(process.execPath, [SCRIPT, "--run-dir", runDir, "--out", out, "--force", ...extra], {
      encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
      env: pinEnvAll({ ...process.env }, { CLEAROTRON_DATABASE: process.env.CLEAROTRON_DATABASE || "corsearch" }),
    });
    return { code: 0, out: stdout };
  } catch (e) {
    return { code: e.status ?? -1, out: `${e.stdout ?? ""}${e.stderr ?? ""}` };
  }
}

test("a finished run freezes clean: allowlist carried, payloads dropped, report re-renders identically", () => {
  const { root, runDir } = makeRun({ records: 2 });
  const out = join(root, "frozen");
  const r = runFreeze(runDir, out);
  assert.equal(r.code, 0, r.out);

  const frozen = join(out, "run");
  // What publish reads is there…
  for (const f of ["report.md", "findings.json", "status.json", "audit.md", "_driver/profile.json", "_driver/verdict.json"])
    assert.ok(existsSync(join(frozen, f)), `${f} carried: ${r.out}`);
  // …and _records/ came across whole, since it is read by readdir and cannot be enumerated in advance.
  assert.deepEqual(readdirSync(join(frozen, "_records")).sort(), ["eu-00000000.json", "eu-00000001.json"]);
  // The payloads did not.
  assert.ok(!existsSync(driverDir(frozen, "run.jsonl")), "run event log dropped");
  assert.ok(!existsSync(driverDir(frozen, "synthesis.jsonl")), "telemetry dropped");
  assert.ok(!existsSync(driverDir(frozen, "synthesis.attempt1.dispatch.txt")), "dispatch payload dropped");
  assert.ok(!existsSync(driverDir(frozen, "stage-inputs")), "stage inputs dropped");
  // The proof ran and found the rendered report identical, not merely present.
  assert.match(r.out, /report\.html identical/, r.out);
  // The manifest carries only what republishRun reads as an input — no issuedAt, no engineCommit, no tokens.
  const meta = JSON.parse(readFileSync(join(out, "meta.json"), "utf8"));
  assert.deepEqual(Object.keys(meta).sort(), ["codename", "customerKey", "runId", "template"]);
  assert.equal(meta.runId, "tmp8439-aquaplus-2026-01-01-synthetic-fixture");
  assert.equal(meta.codename, "synthetic-fixture");
  assert.ok(existsSync(join(out, "PROVENANCE.md")), "provenance written");
  rmSync(root, { recursive: true, force: true });
});

test("the token rollup is the ONE expected difference, and it is named rather than normalised away", () => {
  const { root, runDir } = makeRun();
  const r = runFreeze(runDir, join(root, "frozen"));
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /meta\.tokens differs as expected/, r.out);
  rmSync(root, { recursive: true, force: true });
});

test("scrub: an operator home path in a frozen file is a finding, and the finding never prints the match", () => {
  const { root, runDir } = makeRun({ plant: { file: "status.json", text: JSON.stringify({ markName: "AQUAPLUS", src: "/home/azureuser/agentplatform/x" }) } });
  const r = runFreeze(runDir, join(root, "frozen"));
  assert.equal(r.code, 1, `scrub must fail the run: ${r.out}`);
  assert.match(r.out, /status\.json: 1× an operator home path \[operator-home\]/, r.out);
  rmSync(root, { recursive: true, force: true });
});

test("scrub: a credential with a value beside it is a finding, and the value is not echoed", () => {
  // Assembled, and made of words. A single high-entropy literal here reads as a real leaked credential
  // to the repo's own gitleaks gate — a test fixture that fails the secret scan is a test fixture that
  // stops the build. What the scrub rule needs is a value-shaped run of characters after the `=`, and
  // this is one.
  const secret = ["not", "a", "real", "secret", "value"].join("-");
  const { root, runDir } = makeRun({ plant: { file: "audit.md", text: `---\n---\n\n# Audit Trail\n\n- note: EUIPO_CLIENT_SECRET=${secret}\n` } });
  const r = runFreeze(runDir, join(root, "frozen"));
  assert.equal(r.code, 1, `credential must fail the run: ${r.out}`);
  assert.match(r.out, /credential-assignment/, r.out);
  assert.ok(!r.out.includes(secret), "the tool must never print the secret it found");
  rmSync(root, { recursive: true, force: true });
});

test("--codename renames the whole identity: the runId, the pool dir and the manifest follow", () => {
  // Not a cosmetic field. Every run codename is an <adj>-<noun> pair from the generator vocabulary, and
  // check 2 of no-client-identifiers.test.mjs refuses one anywhere in the tracked tree — content AND
  // paths. A --codename that left the runId alone would leave the sample uncommittable, which is the
  // whole reason this flag exists.
  const { root, runDir } = makeRun();
  const out = join(root, "frozen");
  const r = runFreeze(runDir, out, ["--codename", "renamed-sample"]);
  assert.equal(r.code, 0, r.out);
  const meta = JSON.parse(readFileSync(join(out, "meta.json"), "utf8"));
  assert.equal(meta.codename, "renamed-sample");
  assert.equal(meta.runId, "tmp8439-aquaplus-2026-01-01-renamed-sample", "the runId carries the new codename");
  rmSync(root, { recursive: true, force: true });
});

test("the codename echo names every frozen file that still carries the run's birth codename", () => {
  // The rename moves the identity; it does not touch the artifacts, and the codename is written INTO
  // them. Whoever lands the real sample needs the list, not a reminder that a list exists.
  const { root, runDir } = makeRun();
  // status.json is where a real run carries it; put it there so the check is over the real shape.
  writeFileSync(join(runDir, "status.json"), JSON.stringify({ markName: "AQUAPLUS", codename: "synthetic-fixture" }));
  const r = runFreeze(runDir, join(root, "frozen"), ["--codename", "renamed-sample"]);
  assert.equal(r.code, 1, "a surviving birth codename is a finding, not a note");
  assert.match(r.out, /still carry the source codename "synthetic-fixture"/, r.out);
  assert.match(r.out, /status\.json/, r.out);
  rmSync(root, { recursive: true, force: true });
});

test("an absent report.md is refused as 'could not look' (exit 2), not reported as a clean freeze", () => {
  const { root, runDir } = makeRun();
  rmSync(join(runDir, "report.md"));
  const r = runFreeze(runDir, join(root, "frozen"));
  assert.equal(r.code, 2, r.out);
  assert.match(r.out, /no report\.md/, r.out);
  rmSync(root, { recursive: true, force: true });
});

test("the republish proof CATCHES an allowlist that lost an input the renderer reads", () => {
  // The whole point of step 5. Drive the tool with a deliberately holed allowlist and prove it notices —
  // otherwise "the two reports matched" only ever means "the tool did not look".
  const { root, runDir } = makeRun();
  const holed = join(root, "holed-freeze.mjs");
  const src = readFileSync(SCRIPT, "utf8");
  // Drop findings.json from the allowlist. publishReport falls back to dirname(reportMd)/findings.json,
  // which in the FROZEN tree does not exist — so the frozen report renders without the machine contract.
  const holedAllowlist = src.replace(/^\s*\{ path: "findings\.json".*$/m, "");
  assert.notEqual(holedAllowlist, src, "the allowlist line must exist to be holed");
  // The copy lives outside the repo, so its own REPO derivation (relative to import.meta.url) would
  // point at the temp dir. Pin it to the real checkout — the allowlist is what is under test here.
  const patched = holedAllowlist.replace(
    /^const REPO = .*$/m,
    `const REPO = ${JSON.stringify(join(HERE, "..", ".."))};`,
  );
  assert.notEqual(patched, holedAllowlist, "the REPO derivation must exist to be pinned");
  // — the same problem one level down. The copy's RELATIVE imports also resolve against the temp
  // dir, so `../shared/driver-dir.mjs` is not there. Pin it to the real checkout for the same reason
  // REPO is pinned above: what is under test is the allowlist, not module resolution.
  const pinned = patched.replace(
    /^(import \{[^}]*\} from )["'][^"']*shared\/driver-dir\.mjs["'](.*)$/m,
    (_m, head, tail) => `${head}${JSON.stringify(join(HERE, "..", "..", "shared", "driver-dir.mjs"))}${tail}`,
  );
  assert.notEqual(pinned, patched, "the shared/driver-dir.mjs import must exist to be pinned");
  writeFileSync(holed, pinned);
  let code = 0, out = "";
  try {
    out = execFileSync(process.execPath, [holed, "--run-dir", runDir, "--out", join(root, "frozen"), "--force"], {
      encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
      env: pinEnvAll({ ...process.env }, { CLEAROTRON_DATABASE: process.env.CLEAROTRON_DATABASE || "corsearch" }),
    });
  } catch (e) { code = e.status ?? -1; out = `${e.stdout ?? ""}${e.stderr ?? ""}`; }
  assert.equal(code, 1, `a holed allowlist must be a finding: ${out}`);
  assert.match(out, /FINDING: .*(?:differs|publishes fewer artifacts)/, out);
  // and specifically over the delivered surface, not only over a sidecar
  assert.match(out, /report\.html differs between the source run and the frozen copy/, out);
  rmSync(root, { recursive: true, force: true });
});
