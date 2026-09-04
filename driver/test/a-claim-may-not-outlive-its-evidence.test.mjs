// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// — A CORRECTIVE PASS MAY NOT LEAVE A CLAIM STANDING ON EVIDENCE IT REMOVED.
//
// A scored run was refused at the re-check: the pass deleted the evidence for a claim about a named
// third party's regulatory status, kept the claim on the opening page, and hardened it. Thirteen of
// fourteen corrections landed cleanly; this one was created while resolving the others.
//
// TWO ARMS, BECAUSE THE RUN CARRIED TWO SHAPES AND ONLY ONE WAS REPORTED. Measured against that run's
// own pre/post pair (an R2 comparison round, 2026-08-22): **4 of arm A and 6 of arm B**. Arm B moves the
// other way and is invisible to every check the issue proposed — nothing is deleted, the prose may be
// byte-identical, and `verified-from-record` is the STRONGEST basis, so a rule reading the claim alone
// sees nothing at all.
//
// THE FIXTURES ARE BUILT, NOT COPIED. The run's findings name real companies; the product tree is
// de-identified by design. Same structure, invented marks — and the numbers above are the out-of-tree
// measurement, quoted so a reader can re-run it against the preserved pair.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { evidenceClaimViolations, evidenceFellClaimHeld, demotedStampReasserted, evidenceClaimTable, BASIS_RANK }
  from "../evidence-claim-invariant.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

const meter = (basis, source = "https://register.test/mark/ch/x1") => ({ token: "confirmed", basis, source });
const finding = (mark, over = {}) => ({
  mark, owner: { name: `${mark} Holdings` }, band: "High",
  legal_position: "The registration is live and the goods overlap on the incumbent class.",
  practical_position: "The owner appears active in the market.",
  meters: { use: meter("verified-from-record"), goods_proximity: meter("verified-from-record") },
  ...over,
});

// ── ARM A — evidence fell, the band did not ──────────────────────────────────────────────────────────
test("#1557 A: evidence removed while the band holds is a violation, however the prose moved", () => {
  const before = [finding("ALPHA")];
  // the byte-identical shape: no text diff can see this one
  const identical = [finding("ALPHA", { meters: { use: { token: "unknown", basis: "inferred-from-signal", source: "" },
    goods_proximity: meter("verified-from-record") } })];
  const v1 = evidenceFellClaimHeld(before, identical);
  assert.equal(v1.length, 1);
  assert.equal(v1[0].meter, "use");
  assert.equal(v1[0].claimIdentical, true, "the shape a claim-text diff cannot see");
  assert.equal(v1[0].sourceDeleted, true);

  // the strengthening shape: the claim GREW as its citation was deleted
  const grown = [finding("ALPHA", {
    legal_position: "The registration is live and the goods overlap on the incumbent class. "
      + "The product is supplied on prescription, which narrows the channel decisively.",
    meters: { use: { token: "unknown", basis: "inferred-from-signal", source: "" },
      goods_proximity: meter("verified-from-record") } })];
  const v2 = evidenceFellClaimHeld(before, grown);
  assert.equal(v2.length, 1);
  assert.equal(v2[0].claimIdentical, false);
  assert.ok(v2[0].claimGrewBy > 0, "the claim gained text as its support was removed");
});

test("#1557 A: a band that MOVES discharges the invariant — this is not a deletion ban", () => {
  // The requirement is that a claim may not outlive its evidence, not that evidence may never be
  // removed. A pass that removes support and lowers the band has done the honest thing.
  const before = [finding("ALPHA")];
  const after = [finding("ALPHA", { band: "Medium",
    meters: { use: { token: "unknown", basis: "inferred-from-signal", source: "" },
      goods_proximity: meter("verified-from-record") } })];
  assert.deepEqual(evidenceFellClaimHeld(before, after), []);
});

test("#1557 A: an unchanged finding is not a violation", () => {
  const rows = [finding("ALPHA"), finding("BETA")];
  assert.deepEqual(evidenceFellClaimHeld(rows, structuredClone(rows)), [],
    "THE NEGATIVE CONTROL: a pass that changed nothing must produce nothing");
});

// ── ARM B — a demoted stamp is re-asserted ───────────────────────────────────────────────────────────
test("#1557 B: a stamp the driver demoted as unprovable may not read verified-from-record again", () => {
  const after = [finding("ALPHA")];       // goods_proximity is verified-from-record
  const demotions = [{ ordinal: 1, mark: "ALPHA", meter: "goods_proximity",
    uri: "/mark/ch/x1", why: "record-on-disk-never-read" }];
  const v = demotedStampReasserted(after, demotions);
  assert.equal(v.length, 1);
  assert.equal(v[0].meter, "goods_proximity");
  assert.equal(v[0].demotedWhy, "record-on-disk-never-read",
    "the reason travels — 'the driver disagreed' is weaker than 'the driver recorded why it could not back this'");
});

test("#1557 B: a demoted stamp that STAYED demoted is not a violation", () => {
  const after = [finding("ALPHA", { meters: { use: meter("verified-from-record"),
    goods_proximity: { token: "unknown", basis: "inferred-from-signal", source: "" } } })];
  const demotions = [{ mark: "ALPHA", meter: "goods_proximity", why: "record-on-disk-never-read" }];
  assert.deepEqual(demotedStampReasserted(after, demotions), [],
    "THE NEGATIVE CONTROL: the demotion held, which is the system working");
});

test("#1557 B: a verified stamp the driver never demoted is left alone", () => {
  assert.deepEqual(demotedStampReasserted([finding("ALPHA")], [{ mark: "BETA", meter: "use", why: "x" }]), [],
    "this arm judges only stamps the driver actually ruled on");
});

// ── the shape of the whole answer ────────────────────────────────────────────────────────────────────
test("#1557 both arms report together, arm B first, and absence is stated not implied", () => {
  const before = [finding("ALPHA")];
  const after = [finding("ALPHA", { meters: { use: { token: "unknown", basis: "inferred-from-signal", source: "" },
    goods_proximity: meter("verified-from-record") } })];
  const demotions = [{ mark: "ALPHA", meter: "goods_proximity", why: "record-on-disk-never-read" }];
  const r = evidenceClaimViolations({ before, after, demotions });
  assert.equal(r.violations.length, 2);
  assert.equal(r.violations[0].arm, "demoted-stamp-reasserted", "the stronger claim leads");
  assert.equal(r.violations[1].arm, "evidence-fell-claim-held");
  // An empty result and a missing snapshot must not read the same — the caller can tell which it got.
  assert.deepEqual(r.snapshots, { before: 1, after: 1, demotions: 1 });
  const none = evidenceClaimViolations({});
  assert.deepEqual(none.violations, []);
  assert.deepEqual(none.snapshots, { before: null, after: null, demotions: null },
    "nulls, not zeros: 'no findings' and 'no snapshot' are different facts");
});

test("#1557 malformed input reports nothing and throws nothing", () => {
  for (const bad of [null, undefined, "x", [null], [{}], [{ meters: null }], [{ meters: { use: null } }]]) {
    assert.deepEqual(evidenceClaimViolations({ before: bad, after: bad, demotions: bad }).violations, [],
      `threw or reported on ${JSON.stringify(bad)}`);
  }
});

test("#1557 the ladder is the run's own, and ordered", () => {
  assert.ok(BASIS_RANK["verified-from-record"] > BASIS_RANK.assumed);
  assert.ok(BASIS_RANK.assumed > BASIS_RANK["inferred-from-signal"]);
  assert.ok(BASIS_RANK["inferred-from-signal"] > BASIS_RANK["not-checked"]);
  // AN UNKNOWN BASIS RANKS AS null AND IS NEVER COMPARED. A new token must not read as 0, because then
  // every meter that acquires it looks like a fall from whatever it held before — a phantom violation
  // on a run where nothing went wrong.
  //
  // THE DIRECTION MATTERS AND MY FIRST VERSION OF THIS ARM HAD IT BACKWARDS. Testing unknown → known
  // passes whether the rank is null or 0, because 0 is not less than 1; the fault only shows on
  // KNOWN → UNKNOWN, where a rank of 0 sits below `verified-from-record` and reports a fall. Seeded
  // `?? 0` in place of `?? null` and the old arm stayed green.
  const known = [finding("ALPHA", { meters: { use: meter("verified-from-record") } })];
  const unknown = [finding("ALPHA", { meters: { use: meter("some-future-basis") } })];
  assert.deepEqual(evidenceFellClaimHeld(known, unknown), [],
    "an unrecognised basis is not judged: a guess here reports a defect that is not there");
  // and the harmless direction stays quiet too
  assert.deepEqual(evidenceFellClaimHeld(unknown, known), []);
});

// ── the wiring ───────────────────────────────────────────────────────────────────────────────────────
//
// A pure module nobody calls is inert, and this suite would be entirely green over a build that never
// runs the check. taught that the expensive way: a tell computed and recorded nowhere. A source
// scan cannot prove a real run emits the event — nothing here drives that pipeline branch — but it does
// prove the call, the artifact and the run.jsonl row are all still present.
test("#1557 the invariant is CALLED at the corrective seam, and its result is recorded", () => {
  const src = readFileSync(join(HERE, "..", "pipeline.mjs"), "utf8");
  assert.match(src, /import \{[^}]*evidenceClaimViolations[^}]*\} from "\.\/evidence-claim-invariant\.mjs"/,
    "imported");
  assert.match(src, /evidenceClaimViolations\(\{\s*before:[^}]*after:[^}]*demotions/,
    "called with all three inputs — the demotion list is arm B's entire before-state");
  assert.match(src, /event:\s*"evidence-claim-invariant"[^}]*violations:/,
    "the count reaches run.jsonl");
  assert.match(src, /evidence-claim-violations\.json/,
    "and the violations themselves reach an artifact, not just a count");
  // The failure arm must record too: a check that threw and a check that found nothing must not look
  // the same in the log.
  const rowsLogged = src.split("\n").filter((l) => /event:\s*"evidence-claim-invariant"/.test(l));
  assert.equal(rowsLogged.length, 2, `expected a success and a failure row, found ${rowsLogged.length}`);
  assert.ok(rowsLogged.some((l) => /ok:\s*false/.test(l)), "the failure row says so");
});

// ── — THE VIOLATIONS MUST REACH THE SEAT THAT CAN JUDGE THEM ───────────────────────────────────
//
// The first cut of this feature wrote the violations to `_driver/evidence-claim-violations.json`, logged
// a count, and said in its own comment that they were "RECORDED, AND CARRIED TO THE RECHECK". Nothing
// read the file. The recheck seat holds no tool that could read it, no module in driver/ or scripts/
// mentions it, and the `note()` beside the write is stderr. **An escalation that reaches no reader is a
// log line**, and this is the third time in one session that a computed signal turned out to be recorded
// nowhere — so this arm drives the real composer rather than scanning for the call.
test("#1557 the violations ride the recheck dispatch, as data the seat can read", async () => {
  const { repairFollowup } = await import("../repair-composers.mjs");
  const violations = [
    { arm: "demoted-stamp-reasserted", finding: "ALPHA|ALPHA Holdings", meter: "goods_proximity",
      demotedWhy: "record-on-disk-never-read" },
    { arm: "evidence-fell-claim-held", finding: "BETA|BETA Holdings", meter: "use",
      basis: { before: "verified-from-record", after: "inferred-from-signal" },
      sourceDeleted: true, band: "High", claimIdentical: true, claimGrewBy: 0 },
  ];
  const text = repairFollowup("narrative-refutation:verdict-recheck", {
    narrative: "narrative.md", findings: "findings.json", seniorEyeReview: "senior-eye-review.md",
    correctionsScope: { scoped: false, named: [], moved: [] }, appliedTable: "",
    evidenceTable: evidenceClaimTable(violations), planAuditCarry: "",
  });
  assert.match(text, /ALPHA\|ALPHA Holdings/, "the re-asserted stamp reaches the seat");
  assert.match(text, /BETA\|BETA Holdings/, "so does the claim that outlived its support");
  assert.match(text, /record-on-disk-never-read/, "with the driver's own reason for the demotion");
  assert.match(text, /BYTE-IDENTICAL/, "and the shape a text diff cannot see is called out by name");
  assert.match(text, /not a judgement/i, "as DATA — the seat decides whether the change was wrong");
});

test("#1557 the PIPELINE passes it — the composer working proves nothing about the call site", () => {
  // The arm above drives the composer directly, so it stays green over a build where the pipeline never
  // passes `evidenceTable` at all. That is exactly the hole this whole issue is about — a signal computed
  // correctly and handed to nobody — and removing the argument from the call site reds nothing without
  // this. Verified by seeding: deleting `evidenceTable` from the dispatch args left the suite green.
  const src = readFileSync(join(HERE, "..", "pipeline.mjs"), "utf8");
  assert.match(src, /const evidenceTable = evidenceClaimTable\(/, "the table is rendered at the seam");
  const dispatch = src.split("\n").find((l) => /correctionsScope,\s*appliedTable/.test(l));
  assert.ok(dispatch, "found the recheck dispatch args");
  assert.match(dispatch, /evidenceTable/,
    "and the recheck dispatch carries it, beside the corrections table it sits with");
});

test("#1557 a clean pass leaves the recheck dispatch byte-identical", () => {
  // The dispatch is the expensive artifact on this seam. No violations must cost it nothing at all.
  assert.equal(evidenceClaimTable([]), "");
  assert.equal(evidenceClaimTable(null), "");
  assert.equal(evidenceClaimTable(undefined), "");
});

test("#1557 the table names both arms distinctly — a reader must not have to infer which is which", () => {
  const t = evidenceClaimTable([
    { arm: "demoted-stamp-reasserted", finding: "A|A", meter: "use", demotedWhy: "record-on-disk-never-read" },
    { arm: "evidence-fell-claim-held", finding: "B|B", meter: "use",
      basis: { before: "verified-from-record", after: "inferred-from-signal" },
      sourceDeleted: true, band: "High", claimIdentical: false, claimGrewBy: 243 },
  ]);
  assert.match(t, /reads verified-from-record again/, "arm B says what it is");
  assert.match(t, /support fell verified-from-record → inferred-from-signal, source deleted/, "arm A says what it is");
  assert.match(t, /GREW by 243 characters/, "and the strengthening is quantified, not implied");
});
