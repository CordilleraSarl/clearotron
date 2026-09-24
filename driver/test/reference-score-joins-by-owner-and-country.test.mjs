// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// — A GOLD ENTRY IS ONE RECORD: A NAME, WHO FILED IT, AND WHERE.
//
// The scorer credited a gold entry to any finding of the same name, whoever filed it and wherever. On a
// matter about a common word that is most of the crowd: a different company's identical mark in another
// country scored as the lawyer's record, one finding could credit two entries, and a lawyer's entry
// written with the company's brand name was lost because the register spells the company's legal name.
//
// The join now asks the owner or the filing country as well as the name, and asks only what both sides
// carry. An entry named with the searched mark alone is joined on the owner, because its name picks out
// no one. EVERY MARK AND OWNER BELOW IS INVENTED; the shapes are the ones the gold sets hold.
import { test } from "node:test";
import { pinEnvAll } from "../../shared/env-aliases.mjs";   // — a spread carries EVERY spelling, so an override must clear every spelling
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { scoreRecall, joinRank, namedBySearchedMark, JOIN } from "../reference-score.mjs";

const SEARCHED = ["TARVELLO"];
const reg = (mark, owner, country) => ({ mark, owner: { name: owner, country }, evidence: "register" });

// ── the rank, alone ──────────────────────────────────────────────────────────────────────────────────

test("an entry named with the searched mark alone is recognised, and a longer name is not", () => {
  assert.equal(namedBySearchedMark({ mark: "TARVELLO" }, SEARCHED), true);
  assert.equal(namedBySearchedMark({ mark: "Tarvello · TARVELLO Stylised" }, SEARCHED), true,
    "a lawyer's alternation between two renderings of the searched word is still the searched word");
  assert.equal(namedBySearchedMark({ mark: "TARVELLO FOODS" }, SEARCHED), false);
});

test("the rank orders owner, then the owner's name inside the register's, then the country", () => {
  const e = { mark: "QUENDRIX", owner: "Harnwick Mills Ltd", jurisdictions: ["FR"] };
  assert.equal(joinRank(e, reg("QUENDRIX", "Harnwick Mills Limited", "DE")), JOIN.owner, "the owner matches");
  assert.equal(joinRank(e, reg("QUENDRIX", "Kestamor Foods GmbH", "FR")), JOIN.country, "only the country agrees");
  assert.equal(joinRank(e, reg("QUENDREX", "Kestamor Foods GmbH", "FR"), { rule: "skeleton" }), 0,
    "a near-form under a different owner is another company's mark, whatever country it shares");
  assert.equal(joinRank(e, reg("QUENDRIX", "Kestamor Foods GmbH", "DE")), 0, "nothing agrees");
  assert.equal(joinRank({ mark: "QUENDRIX", owner: "Harnwick" }, reg("QUENDRIX", "Harnwick Mills Ltd", "DE")), 0,
    "the lawyer's short owner inside the register's does not admit on its own for an ordinary entry");
});

test("a pair with nothing both sides carry keeps the name-only join", () => {
  assert.equal(joinRank({ mark: "QUENDRIX" }, reg("QUENDRIX", "Kestamor Foods GmbH", "DE")), JOIN.unasked,
    "the entry names neither owner nor country");
  assert.equal(joinRank({ mark: "QUENDRIX", owner: "Harnwick Mills Ltd" }, { mark: "QUENDRIX", territory: "de" }), JOIN.unasked,
    "the entry names only an owner and the record carries only an office");
});

// ── the buckets ──────────────────────────────────────────────────────────────────────────────────────

test("a different company's identical mark filed elsewhere is not the lawyer's record, and it lands in noise", () => {
  const reference = [{ mark: "QUENDRIX", owner: "Harnwick Mills Ltd", jurisdictions: ["FR"], classes: [9] }];
  const findings = [{ ordinal: 1, ...reg("QUENDRIX", "Kestamor Foods GmbH", "DE") }];
  const b = scoreRecall({ reference, findings, retrieved: [], scopeClasses: ["9"] });
  assert.deepEqual(b.found, [], "no find is manufactured from another proprietor's mark in another country");
  assert.deepEqual(b.lost.map((r) => r.mark), ["QUENDRIX"]);
  assert.deepEqual(b.noise.map((r) => r.ordinal), [1],
    "the refused finding lands in a bucket, never in none — every finding is accounted for");
});

test("the same company spelled two ways is joined by the country they share", () => {
  // The lawyer writes the brand, the register the legal name: the owner test cannot join them.
  const reference = [{ mark: "FELDRIN / FELDRIN AI", owner: "Feldrin AI", jurisdictions: ["NZ"], classes: [42] }];
  const findings = [{ ordinal: 4, ...reg("FELDRIN", "FELDRINDOCS LIMITED", "NZ") }];
  const b = scoreRecall({ reference, findings, retrieved: [], scopeClasses: ["42"] });
  assert.deepEqual(b.found.map((r) => r.matched_ordinal), [4],
    "a fragment of a decomposed gold label is credited when the filing country agrees");
});

test("an entry named with the searched mark alone needs its owner, even in its own country", () => {
  const reference = [{ mark: "TARVELLO", owner: "Dunmarra Holdings", jurisdictions: ["FR"], classes: [9] }];
  const stranger = [{ ordinal: 1, ...reg("TARVELLO", "Kestamor Foods GmbH", "FR") }];
  const miss = scoreRecall({ reference, findings: stranger, retrieved: [], scopeClasses: ["9"], searchedMarks: SEARCHED });
  assert.deepEqual(miss.found, [], "the crowd holds the searched word in every country; the country alone picks no one");
  assert.deepEqual(miss.noise.map((r) => r.ordinal), [1]);

  const own = [...stranger, { ordinal: 2, ...reg("TARVELLO", "Dunmarra Holdings SARL", "DE") }];
  const hit = scoreRecall({ reference, findings: own, retrieved: [], scopeClasses: ["9"], searchedMarks: SEARCHED });
  assert.deepEqual(hit.found.map((r) => r.matched_ordinal), [2],
    "the owner decides, strictly or with the lawyer's owner name inside the register's");
});

test("a record with no owner cannot join a searched-mark entry by country", () => {
  // The owner is the only thing that picks out a searched-mark entry. A same-country record that records
  // no owner says nothing about whose it is, so it neither finds nor withholds the entry.
  const reference = [{ mark: "TARVELLO", owner: "Dunmarra Holdings", jurisdictions: ["FR"], classes: [9] }];
  const retrieved = [{ mark: "TARVELLO", owner: null, record_id: "/mark/fr/t1", territory: "fr" }];
  const b = scoreRecall({ reference, findings: [], retrieved, scopeClasses: ["9"], searchedMarks: SEARCHED });
  assert.deepEqual(b.withheld, [], "an ownerless record is not the lawyer's record");
  assert.match(b.lost[0]?.why ?? "", /recorded with no owner/, "…and the lost row says what came back");
  // An entry that is NOT the searched word still joins that record on the country.
  const named = scoreRecall({ reference: [{ ...reference[0], mark: "TARVELLO FOODS" }], findings: [],
    retrieved: [{ ...retrieved[0], mark: "TARVELLO FOODS" }], scopeClasses: ["9"], searchedMarks: SEARCHED });
  assert.deepEqual(named.withheld.map((r) => r.mark), ["TARVELLO FOODS"]);
});

test("among candidates the owner outranks the country, whatever the finding order", () => {
  const reference = [{ mark: "BRISKA", owner: "Calvesta", jurisdictions: ["FR"], classes: [9] }];
  const findings = [
    { ordinal: 1, ...reg("BRISKA", "Norrowby Trading", "FR") },
    { ordinal: 2, ...reg("BRISKA", "Calvesta Group", "FR") },
  ];
  const b = scoreRecall({ reference, findings, retrieved: [], scopeClasses: ["9"] });
  assert.deepEqual(b.found.map((r) => r.matched_ordinal), [2], "the owner's own finding is cited, not the first in order");
});

test("one finding credits one entry", () => {
  const reference = [
    { mark: "BRISKA", owner: "Calvesta", jurisdictions: ["FR"], classes: [9] },
    { mark: "BRISKA", owner: "Orveline", jurisdictions: ["FR"], classes: [9] },
  ];
  const findings = [{ ordinal: 1, ...reg("BRISKA", "Norrowby Trading", "FR") }];
  const b = scoreRecall({ reference, findings, retrieved: [], scopeClasses: ["9"] });
  assert.equal(b.found.length, 1, "a finding spent on one entry is not offered to the next");
  assert.equal(b.lost.length, 1);
});

test("withheld asks the same question, and a lost row names what came back under another proprietor", () => {
  const reference = [
    { mark: "QUENDRIX", owner: "Harnwick Mills Ltd", jurisdictions: ["FR"], classes: [9] },
    { mark: "BRISKA", owner: "Calvesta", jurisdictions: ["FR"], classes: [9] },
  ];
  const retrieved = [
    { mark: "QUENDRIX", owner: "Harnwick Mills Limited", record_id: "/mark/fr/q1", territory: "fr" },
    { mark: "BRISKA", owner: "Norrowby Trading", record_id: "/mark/de/b1", territory: "de" },
  ];
  const b = scoreRecall({ reference, findings: [], retrieved, scopeClasses: ["9"] });
  assert.deepEqual(b.withheld.map((r) => r.mark), ["QUENDRIX"], "its own record was held and dropped");
  const lost = b.lost.find((r) => r.mark === "BRISKA");
  assert.ok(lost, "another company's record in another country does not make the entry withheld");
  assert.match(lost.why, /held by another proprietor, filed elsewhere, or recorded with no owner/);
  assert.match(lost.why, /Norrowby Trading/, "…and the row says whose record it was");
});

// ── driven through score.mjs, so the filing office is read off the finding the way a run records it ───

test("score.mjs reads the filing office from each registration and joins on it", () => {
  const store = mkdtempSync(join(tmpdir(), "join-store-"));
  const run = mkdtempSync(join(tmpdir(), "join-run-"));
  try {
    mkdirSync(join(store, "baselines"));
    writeFileSync(join(store, "baselines", "JN1.gold.json"), JSON.stringify({
      schema_version: 1, scenario: "JN1", mark: "TARVELLO", source: "synthetic fixture, this test — never a real matter",
      register: [
        { mark: "FELDRIN / FELDRIN AI", owner: "Feldrin AI", jurisdictions: ["NZ"], classes: [42] },
        { mark: "TARVELLO", owner: "Dunmarra Holdings", jurisdictions: ["FR"], classes: [42] },
      ],
    }));
    const finding = (ordinal, mark, owner, country, office) => ({ ordinal, mark, band: { label: "Medium" },
      source: { source_type: "register-vendor" },
      owner: { name: owner, country, registrations: [{ uri: `/mark/${office}/tm_${ordinal}` }] } });
    writeFileSync(join(run, "findings.json"), JSON.stringify({ findings: [
      // Owned from abroad, filed in the gold's country: the office decides, not the owner's address.
      finding(1, "FELDRIN", "FELDRINDOCS LIMITED", "AU", "nz"),
      finding(2, "TARVELLO", "Kestamor Foods GmbH", "DE", "fr"),
    ] }));
    const r = spawnSync("node", [join(dirname(fileURLToPath(import.meta.url)), "..", "..", "scripts", "score.mjs"), "JN1", "--run", run, "--json"], {
      encoding: "utf8",
      env: pinEnvAll({ ...process.env }, { CLEAROTRON_E2E_DIR: store, CLEAROTRON_WORK_DIR: "" }),
    });
    assert.equal(r.status, 0, `score.mjs refused the fixture:\n${r.stderr}`);
    const out = JSON.parse(r.stdout);
    assert.deepEqual(out.buckets.found.map((f) => f.matched_ordinal), [1], "the office in the registration uri joined it");
    assert.deepEqual(out.buckets.noise.map((f) => f.ordinal), [2],
      "the searched word under another owner is noise, though it is filed in the gold's country");
  } finally {
    rmSync(store, { recursive: true, force: true });
    rmSync(run, { recursive: true, force: true });
  }
});
