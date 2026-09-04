// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// — A GOLD ENTRY MUST NOT BE CREDITED TO A DIFFERENT PROPRIETOR'S MARK ON A FRAGMENT OF ITS NAME.
//
// Two defects, one outcome. `labelAliases` split a mark on an interior middot or ampersand, so a mark
// whose own NAME contains one was cut into pieces; and the alias rule had no owner gate, so each piece
// was a standalone key any proprietor's mark could turn. A gold mark the run never retrieved scored
// `found`, which inflates recall on the exact axis the harness exists to measure.
//
// gated containment for this reason and this is the same class one rule over. The precedent is
// why the fix is a gate and not a new matcher.
//
// EVERY MARK AND OWNER BELOW IS INVENTED. The real evidence is four gold sets of lawyer answers to live
// client matters; naming them here would put client identifiers in a tree that is de-identified by
// design. The shapes are what carry over, and they are the shapes the corpus actually holds: a mark
// with an UNSPACED middot inside its name, a lawyer's SPACED middot alternation between two renderings
// of one record, and a mark whose name contains an ampersand.
//
// Driven through `scripts/score.mjs` against a run directory, never by handing rows to the scorer: a
// test that builds its own findings is how the companion defect survived.
import { test } from "node:test";
import { pinEnvAll } from "../../shared/env-aliases.mjs";   // — a spread carries EVERY spelling, so an override must clear every spelling
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SCORE = join(REPO, "scripts", "score.mjs");

const HOLDER = "Verrit Instruments Ltd";
const STRANGER = "Kelbrook Trading GmbH";

const GOLD = {
  schema_version: 1,
  scenario: "BF2",
  source: "synthetic fixture, this test — never a real matter",
  register: [
    // The mark's own name contains the middot. It is one name, not two.
    { mark: "ZEPHYR·QT", owner: HOLDER },
    // The lawyer's alternation: one record written two ways, separated by a SPACED middot.
    { mark: "NIMBUS · NIMBUS Stylised", owner: HOLDER },
    // An ampersand inside one name.
    { mark: "HARBOUR DENTAL & MEDICAL SUPPLY", owner: HOLDER },
    // A plain single name, for the full-identity arm.
    { mark: "CALDERA", owner: HOLDER },
  ],
};

const finding = (ordinal, mark, owner) => ({ ordinal, mark, owner: { name: owner }, band: { label: "High" } });

function score(findings) {
  const store = mkdtempSync(join(tmpdir(), "alias-gate-store-"));
  const run = mkdtempSync(join(tmpdir(), "alias-gate-run-"));
  try {
    mkdirSync(join(store, "baselines"));
    writeFileSync(join(store, "baselines", "BF2.gold.json"), JSON.stringify(GOLD, null, 2));
    writeFileSync(join(run, "findings.json"), JSON.stringify({ findings }, null, 2));
    const r = spawnSync("node", [SCORE, "BF2", "--run", run, "--json"], {
      encoding: "utf8",
      env: pinEnvAll({ ...process.env }, { CLEAROTRON_E2E_DIR: store, CLEAROTRON_WORK_DIR: "" }),
    });
    assert.equal(r.status, 0, `score.mjs refused the fixture:\n${r.stderr}`);
    const out = JSON.parse(r.stdout);
    return {
      found: new Set(out.buckets.found.map((f) => f.mark)),
      rule: new Map(out.buckets.found.map((f) => [f.mark, f.rule])),
    };
  } finally {
    rmSync(store, { recursive: true, force: true });
    rmSync(run, { recursive: true, force: true });
  }
}

test("a mark's own name is not split at an unspaced middot into fragments anyone can satisfy", () => {
  // A stranger's two-token mark that happens to be the first half of the gold's ONE name.
  const s = score([finding(1, "ZEPHYR", STRANGER)]);
  assert.equal(s.found.has("ZEPHYR·QT"), false,
    "the gold entry was credited to a different proprietor's shorter mark — the run retrieved nothing "
    + "of this registration, and scoring it `found` inflates recall on the axis the harness measures");
});

test("the fragment is no longer an ALIAS, so what remains is the owner-gated rule #1411 governs", () => {
  // The owner gate is not the whole fix, and this arm is what says so — but it says it precisely.
  //
  // Under the entry's OWN proprietor this pair still matches, and that is by design, not a leak:
  // rule 4 reads `ZEPHYR` as a contiguous word run inside `ZEPHYR·QT` and deliberately permits
  // exactly that — one proprietor rendering one record long or short. So the assertion is NOT that
  // nothing matches. It is that the match no longer rests on a manufactured alias, which is the only
  // route that reaches a STRANGER. Assert the RULE, because the outcome alone cannot tell the two apart.
  const s = score([finding(1, "ZEPHYR", HOLDER)]);
  assert.notEqual(s.rule.get("ZEPHYR·QT"), "alias",
    "an unspaced middot is part of the name, so no fragment of it is an alias — a surviving `alias` here "
    + "means the splitter was reverted and the stranger arm above is passing for the wrong reason");
  assert.equal(s.rule.get("ZEPHYR·QT"), "contained",
    "and what does fire is the owner-gated containment rule, which is #1411's ruling and not this issue's");
});

test("a spaced middot alternation still matches its own rendering, under the proprietor", () => {
  const s = score([finding(1, "NIMBUS", HOLDER)]);
  assert.equal(s.found.has("NIMBUS · NIMBUS Stylised"), true,
    "a SPACED middot is the lawyer's alternation between two renderings of one record, and splitting it "
    + "is correct and wanted — this is the case the fix must not cost");
});

test("that alternation does not reach a different proprietor's mark of the same name", () => {
  const s = score([finding(1, "NIMBUS", STRANGER)]);
  assert.equal(s.found.has("NIMBUS · NIMBUS Stylised"), false,
    "matching ONE alternative of a decomposed label claims the lawyer's record on a fragment of its "
    + "identity, and only the proprietor tells that from a different company using the same word");
});

test("an ampersand inside a name does not split it either", () => {
  const s = score([finding(1, "MEDICAL SUPPLY", STRANGER)]);
  assert.equal(s.found.has("HARBOUR DENTAL & MEDICAL SUPPLY"), false,
    "`&` joins words inside one name; splitting made the tail a standalone identity");
});

test("full identity stays ungated — a different proprietor's identical mark is still a find", () => {
  // The gate must not become a recall collapse dressed as precision. `ownersMatch` is fail-closed, and
  // a stranger registering the identical mark is precisely the conflict this engine exists to surface.
  const s = score([finding(1, "CALDERA", STRANGER)]);
  assert.equal(s.found.has("CALDERA"), true,
    "gating exact single-name equality on owner would send every entry whose owner the gold does not "
    + "record straight to `lost`");
  assert.equal(s.rule.get("CALDERA"), "alias", "and it should still be reported as the alias rule");
});

test("a RELABELLED finding still matches: the gate is on the reference side, not the candidate's", () => {
  // The case that refuted the first version of this fix, kept as an arm because the rule it killed is
  // the one a reader would otherwise re-derive. A round rewrote one mark as a multi-name composite —
  // the CANDIDATE decomposed, while the gold's identity, one name, was matched in FULL. Nothing is
  // claimed on a fragment, so no owner is needed and a stranger's relabelling is still a real find.
  //
  // Gating on both sides would turn every relabelled finding into a `lost`, which reads as a recall
  // defect in the engine while the cause sits in the instrument.
  const s = score([finding(1, "CALDERA / CALDERAMONO / CALDERAKOMB", STRANGER)]);
  assert.equal(s.found.has("CALDERA"), true,
    "the gold's whole identity matched one of the candidate's alternatives — that is not a fragment match");
});

test("the scorer stamps a version that separates these buckets from the inflated ones", () => {
  // 2064 — THE SPAWN'S OWN FATE FIRST, the verdict second. On a loaded box the child did not come
  // back, stdout was empty, Number("") was 0, and this arm asserted "recall too HIGH" about a scorer
  // that was fine — on the exact command INSTALL.md tells a new reader to run. A could-not-look must
  // say so by name and show what the child actually produced; only a clean spawn's stdout is a verdict.
  const s = spawnSync("node", ["-e",
    "import('./driver/reference-score.mjs').then(m => console.log(m.SCORER_VERSION))"], {
    cwd: REPO, encoding: "utf8", timeout: 30000 });
  assert.ok(!s.error && s.status === 0 && !s.signal,
    `the version probe did not come back (status=${s.status} signal=${s.signal} error=${s.error?.message ?? "none"}) `
    + `— a loaded box or a broken spawn, NOT a scorer verdict. stderr:\n${s.stderr}`);
  const raw = s.stdout.trim();
  assert.match(raw, /^\d+$/,
    `the probe printed no version number — raw stdout ${JSON.stringify(s.stdout)}, stderr ${JSON.stringify(s.stderr)} — not a scorer verdict either`);
  assert.ok(Number(raw) >= 5,
    "scores at 4 and below report recall too HIGH by an unknown amount on any scenario whose gold "
    + "carries a multi-part mark, so the two are not comparable");
});
