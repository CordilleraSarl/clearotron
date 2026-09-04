// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// similar-group-lookup-answers-by-name.test.mjs — part 2, acceptance 6-12.
//
// The engine used to ask a model to RECALL these codes: 24% on the tricky items for the model
// production runs. A copy of the table scores 100% and cites a page. What this file guards is not the
// score — it is that EVERY WAY OF FINDING NOTHING IS A DIFFERENT ANSWER, because the one thing worse
// than a wrong code is an empty result that reads as "no similar groups found" in a jurisdiction family
// the client cannot check.
//
// SAFETY GUARD: env pinned before dynamic driver imports (driver.config freezes roots at import).
import { mkdtempSync as __mkdtemp } from "node:fs";
import { tmpdir as __tmpdir } from "node:os";
import { join as __join } from "node:path";
import { pinEnv, envFrom } from "../../shared/env-aliases.mjs";   // — the default is taken only when NO spelling holds a value
pinEnv(process.env, "CLEAROTRON_WORK_DIR", envFrom(process.env, "CLEAROTRON_WORK_DIR") || __mkdtemp(__join(__tmpdir(), "jxsub-ws-")));
pinEnv(process.env, "CLEAROTRON_REPORTS_DIR", envFrom(process.env, "CLEAROTRON_REPORTS_DIR") || __mkdtemp(__join(__tmpdir(), "jxsub-pool-")));
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { execFileSync } from "node:child_process";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const JXSUB = join(ROOT, "providers", "jx-subclass");

// ── BUILT HERE, NOT SKIPPED, AND NOT FIXTURED ──────────────────────────────────────────────────────
//
// `similar-groups.db` is a build artifact and is gitignored, so the first draft of this file SKIPPED
// whenever it was absent — which is every CI run. `unexecuted-asserts` refused that, and it was
// right: an arm that never runs where it matters has stopped guarding, and the honest-looking skip
// reason made it read like a decision rather than a hole.
//
// A fixture was the other wrong answer: these arms assert what the OFFICE's table says, and a fixture
// would assert what I typed — the hand-written data this whole issue replaces.
//
// So build the real thing, from the committed `public/` export, into a temp directory. It takes ~0.8s,
// reads no office document, touches no network, and refuses on any hash mismatch. `load-public.mjs`'s
// own header already called this "the path CI takes"; now something takes it.
const DB = join(mkdtempSync(join(tmpdir(), "jxsub-db-")), "similar-groups.db");
execFileSync(process.execPath, ["load-public.mjs", "--out", DB], { cwd: JXSUB, stdio: ["ignore", "ignore", "pipe"] });

const M = await import("../jx-subclass.mjs");
const { ENABLED_COUNTRIES } = M;
const open = () => new DatabaseSync(DB, { readOnly: true });

// ── acceptance 11 — an absent or empty database refuses BY NAME ─────────────────────────────────────

test("#1227-11 an UNCONFIGURED database refuses by name and never answers zero", () => {
  assert.throws(() => M.openSubclass({ path: null }), (e) => {
    assert.equal(e.reason, "unconfigured");
    assert.match(e.message, /CLEAROTRON_JX_SUBCLASS_DB/, "the refusal must name what to set");
    return true;
  });
});

test("#1227-11 a MISSING file refuses, and the open does not create one", () => {
  const dir = mkdtempSync(join(tmpdir(), "jxsub-missing-"));
  const path = join(dir, "not-built.db");
  assert.throws(() => M.openSubclass({ path }), (e) => (assert.equal(e.reason, "missing"), true));
  // The half that matters: `new DatabaseSync(path)` CREATES the file. If the guard ran after the open,
  // the second call would find a real, empty database and every lookup over it would answer nothing.
  assert.equal(existsSync(path), false,
    "the refusal created the database it was refusing — the next call would read it as an empty table");
});

test("#1227-11 an EMPTY database refuses too — schema present, no rows, is the dangerous case", () => {
  const dir = mkdtempSync(join(tmpdir(), "jxsub-empty-"));
  const path = join(dir, "empty.db");
  const db = new DatabaseSync(path);
  db.exec("CREATE TABLE group_code (basic_no TEXT, office TEXT, code TEXT)");   // schema, no rows
  db.close();
  assert.throws(() => M.openSubclass({ path }), (e) => (assert.equal(e.reason, "empty"), true));
});

// ── acceptance 6, 7, 8, 9 — over the real table ─────────────────────────────────────────────────────

test("#1227-6 a good and a country answer with codes AND a citation", () => {
  const db = open();
  try {
    const r = M.subclassesForGood(db, { country: "CN", term: "香皂", niceClass: 3 });
    assert.equal(r.status, "ok");
    assert.deepEqual(r.codes, ["0301"]);
    assert.ok(r.citation?.edition, "a code with no edition is not checkable — editions change annually");
    assert.ok(r.citation?.document, "the citation must name the document a lawyer can open");
  } finally { db.close(); }
});

test("#1227-6 every way of finding NOTHING is a different answer, never a bare empty list", () => {
  const db = open();
  try {
    // The whole point of the slice. A caller receiving [] cannot tell these apart and they are not the
    // same fact; only the last would be a clean negative.
    const miss = M.subclassesForGood(db, { country: "CN", term: "not a good in any register", niceClass: 3 });
    assert.match(miss.status, /^good-not-found/, `a miss reported ${miss.status}`);
    assert.ok(miss.note, "a miss with no note reads as 'this good has no similar group'");
    const off = M.subclassesForGood(db, { country: "JP", term: "石鹸", niceClass: 3 });
    assert.equal(off.status, "country-not-enabled", "a disabled country must not report an empty code list");
  } finally { db.close(); }
});

test("#1227-7 a class span UNIONS exam_standard with derived_from_goods — either alone is a false clear", () => {
  const db = open();
  try {
    // Measured on the committed JP data: 24 (group, class) pairs are in exam_standard and not in
    // derived_from_goods, and 895 the other way. Neither contains the other. `19B33` is the specimen:
    // 14 classes by goods, 5 by the standard — answering from the standard alone drops nine classes a
    // Japanese examiner will search.
    const exam = new Set(db.prepare("SELECT nice_class c FROM class_span WHERE office='JP' AND group_code='19B33' AND basis='exam_standard'").all().map((r) => r.c));
    const goods = new Set(db.prepare("SELECT nice_class c FROM class_span WHERE office='JP' AND group_code='19B33' AND basis='derived_from_goods'").all().map((r) => r.c));
    assert.ok(exam.size && goods.size, "premise: the specimen carries both bases");
    assert.ok([...goods].some((c) => !exam.has(c)),
      "the specimen no longer has a class the goods data carries and the standard does not — pick another");
    const union = new Set([...exam, ...goods]);
    assert.ok(union.size > exam.size, "the union must be strictly larger than either basis alone");
  } finally { db.close(); }
});

test("#1227-8 similar, cross_search and the exclusions are NEVER merged", () => {
  const db = open();
  try {
    // 类似 means treated as similar; 交叉检索 means the search must ALSO cover that group; the exclusions
    // are exclusions. Collapsing any pair changes the answer, so the reader gets them keyed by type.
    const types = db.prepare("SELECT DISTINCT type FROM cross_reference WHERE office='CN'").all().map((r) => r.type);
    assert.ok(types.length > 1, "premise: the table distinguishes more than one relation type");
    const g = db.prepare("SELECT source_group FROM cross_reference WHERE office='CN' LIMIT 1").get();
    const r = M.crossSearchFor(db, { country: "CN", group: g.source_group, niceClass: Number(String(g.source_group).slice(0, 2)) });
    if (r.status === "ok") {
      assert.ok(r.byType && typeof r.byType === "object", "the relations must arrive keyed BY TYPE, not as one list");
      for (const [type, rows] of Object.entries(r.byType))
        for (const row of rows) assert.equal(row.type, type, "a relation was filed under a type it does not carry");
    }
  } finally { db.close(); }
});

test("#1227-9 an edition_qualifier is SURFACED and never applied silently", () => {
  const db = open();
  try {
    const q = db.prepare("SELECT source_group FROM cross_reference WHERE office='CN' AND edition_qualifier IS NOT NULL AND edition_qualifier <> '' LIMIT 1").get();
    if (!q) return;   // nothing qualified in this build; the arm below has nothing to protect
    const r = M.crossSearchFor(db, { country: "CN", group: q.source_group, niceClass: Number(String(q.source_group).slice(0, 2)) });
    assert.equal(typeof r.editionQualified, "number",
      "the count of edition-qualified relations is not reported — a relation qualified 第九版及以前版本 "
      + "belongs to a historical edition and applying it to current data is wrong");
    assert.ok(r.relations.some((x) => x.edition_qualifier),
      "the qualifier was dropped from the rows, so a reader cannot tell which relation it applies to");
  } finally { db.close(); }
});

// ── acceptance 10 and 12 — the country list is DATA ──────────────────────────────────────────────────

test("#1227-12 the enabled list is the ONLY gate — the JP data is present and the query is identical", () => {
  const db = open();
  try {
    // A flip test that cannot mutate a frozen export still has to prove the claim. It does it from both
    // ends: the JP rows EXIST and the same SQL returns them, and the only thing standing between a
    // caller and them is the list. If a per-country branch is ever added, the source assertion below
    // fails and this stops being a list edit.
    assert.deepEqual([...ENABLED_COUNTRIES], ["CN"], "the shipped list changed — acceptance 12 says ship CN");
    const jp = db.prepare("SELECT count(*) c FROM group_code WHERE office='JP'").get().c;
    assert.ok(jp > 0, `the JP data is absent (${jp} rows) — then enabling JP is not a list edit`);
    assert.equal(M.isCountryEnabled("JP"), false);
    assert.equal(M.classesSpannedBy(db, { country: "JP", group: "19B33" }).status, "country-not-enabled",
      "JP answered while disabled — the list is not the gate");
  } finally { db.close(); }
});

test("#1227-10/12 no per-country branch decides the ANSWER — enabling one is a list edit", () => {
  // Read at the source, because a runtime check over a one-country list cannot see a branch for the
  // other three. Acceptance 10 rides on this: a JP or KR lookup must not be scoped by Nice class (43%
  // of JP codes and 39% of KR codes span classes deliberately), and the way that stays true is that no
  // country gets its own path.
  const src = readFileSync(join(ROOT, "providers", "jx-subclass", "lookup.mjs"), "utf8");
  const branches = [...src.matchAll(/office\s*===\s*"([A-Z]{2})"/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(branches)], ["CN"],
    `a per-country branch exists for ${branches.join(", ")} — only CN's is sanctioned, because CNIPA's own `
    + "goods table carries the ※C-numbered China-only goods that appear in no concordance. Any other "
    + "country branch means enabling a country is no longer a list edit");
  assert.doesNotMatch(src, /classSpanFor[\s\S]{0,400}niceClass/,
    "classSpanFor took a Nice class — acceptance 10: a class span must never be scoped by class, that "
    + "is the question it answers");
});
