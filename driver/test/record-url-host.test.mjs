// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// record-url-host.test.mjs —. A record URL must name a host the ACTIVE provider declares.
//
// `status-rules.md` stated the record-URL composition rule with ONE vendor's host baked into it, in a
// file every register run loads whatever the provider. So a clarivate or signa run shipped record links
// pointing at Corsearch — and nothing composed those URLs and nothing checked them. The driver passes
// the model's value through verbatim (audit-from-spine, xlsx, render), so it could be wrong in complete
// silence all the way onto a client's report, and the only thing that would ever notice is a lawyer
// clicking a dead link. The issue's words: accepted-by-absence twice over.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseFindingsJson } from "../findings-model.mjs";
import { PROVIDERS } from "../driver.config.mjs";
import { recordOriginsFor } from "../record-origins.mjs";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { nonEmpty } from "../../shared/vacuous-pass.mjs";

const meter = (token, basis = "verified-from-record") => ({ token, basis });
const finding = (over = {}) => ({
  ordinal: 1, mark: "KURENA", owner: { name: "Kurena SA", country: "CH", registrations: [] },
  composite: 4, level: "B", dispute_type: "paper-conflict",
  meters: { mark_similarity: meter("high"), goods_proximity: meter("medium"), use: meter("confirmed"), enforcer: meter("high") },
  quadrant: { x: 0.5, y: 0.5 },
  source: { source_type: "register-vendor", resolved_link: "" },
  ...over,
});
const doc = (f) => JSON.stringify({ schema_version: 1, findings: [f], coverage: [{ area: "register / EU", state: "confirmed-clean", note: "" }] });
const parse = (f, origins) => parseFindingsJson(doc(f), origins === undefined ? {} : { recordOrigins: origins });

// ── the allow-list ──────────────────────────────────────────────────────────────────────────────────

test("#495 recordOriginsFor: a single-office provider declares its own host", () => {
  assert.deepEqual(recordOriginsFor("corsearch"), ["https://tm.corsearch.com"]);
  assert.deepEqual(recordOriginsFor("euipo"), ["https://euipo.europa.eu"]);
  assert.deepEqual(recordOriginsFor("uspto-local"), ["https://tsdr.uspto.gov"]);
});

test("#495 recordOriginsFor: A COMPOSITE RESOLVES THROUGH ITS MEMBERS — free-tier allows both offices", () => {
  // The failure this pins is the one that would have hurt most. free-tier is EUIPO + the USPTO local
  // index and its own publicRecordOrigin is null ON PURPOSE (two offices, two hosts). A gate that read
  // that null as the allow-list would produce an EMPTY set and refuse EVERY free-tier delivery — every
  // one of whose record links is a legitimate EUIPO or USPTO one. That is the free public tier, so the
  // breakage would land hardest on the runs nobody is paying for.
  assert.equal(PROVIDERS["free-tier"].publicRecordOrigin, null, "the composite still declares no single origin");
  const origins = recordOriginsFor("free-tier");
  assert.ok(origins.includes("https://euipo.europa.eu"), "the EU member's host is legitimate here");
  assert.ok(origins.includes("https://tsdr.uspto.gov"), "and the US member's");
  assert.equal(origins.length, 2, "and nothing else");
});

test("#495 recordOriginsFor: a provider with NO public record page declares an empty set, which is an answer", () => {
  // clarivate and signa: hasPublicRecordUrl false — cite the office register instead. Empty is not "no
  // opinion"; it means no absolute record URL is legitimate on this provider, which is what the gate acts on.
  // — TAKEN FROM THE TABLE, not from a hand-written pair: a seventh provider that publishes no record
  // page must inherit this case on the day it is added, without anyone remembering to come here.
  const noPublicPage = Object.keys(PROVIDERS).filter((id) => PROVIDERS[id].hasPublicRecordUrl === false);
  assert.ok(noPublicPage.length, "no provider in the table declares hasPublicRecordUrl:false — this test asserted nothing");
  for (const id of noPublicPage) assert.deepEqual(recordOriginsFor(id), [], `${id} publishes no per-record page`);
});

test("#495 recordOriginsFor: an unknown provider is empty, and a cycle cannot hang the resolver", () => {
  assert.deepEqual(recordOriginsFor("nope"), []);
  assert.deepEqual(recordOriginsFor(null), []);
});

// ── the gate ────────────────────────────────────────────────────────────────────────────────────────

test("#495 a register link on a host the provider does not declare is REFUSED, and the reason names both", () => {
  const f = finding({ source: { source_type: "register-vendor", resolved_link: "https://tm.corsearch.com/mark/us/86264144" } });
  assert.throws(() => parse(f, recordOriginsFor("euipo")), (e) => {
    assert.match(e.message, /finding_record_url_foreign_host:1/, "a token-first reason the corrective ladder can key on");
    assert.match(e.message, /tm\.corsearch\.com/, "the host it found");
    assert.match(e.message, /euipo\.europa\.eu/, "and the host it wanted");
    return true;
  });
});

test("#495 the same link on the provider that DOES publish it passes", () => {
  const f = finding({ source: { source_type: "register-vendor", resolved_link: "https://tm.corsearch.com/mark/us/86264144" } });
  assert.equal(parse(f, recordOriginsFor("corsearch")).findings.length, 1);
});

test("#495 a free-tier run accepts BOTH of its offices' hosts and refuses a third", () => {
  const origins = recordOriginsFor("free-tier");
  for (const link of ["https://euipo.europa.eu/mark/eu/018553557", "https://tsdr.uspto.gov/mark/us/86264144"]) {
    const f = finding({ source: { source_type: "register-vendor", resolved_link: link } });
    assert.equal(parse(f, origins).findings.length, 1, `${link} is legitimate on the free tier`);
  }
  const foreign = finding({ source: { source_type: "register-vendor", resolved_link: "https://tm.corsearch.com/mark/us/86264144" } });
  assert.throws(() => parse(foreign, origins), /finding_record_url_foreign_host/);
});

test("#495 a provider that publishes NO record page refuses an absolute link and says to cite the register", () => {
  const f = finding({ source: { source_type: "register-vendor", resolved_link: "https://tm.corsearch.com/mark/us/86264144" } });
  assert.throws(() => parse(f, recordOriginsFor("clarivate")), (e) => {
    assert.match(e.message, /finding_record_url_foreign_host/);
    assert.match(e.message, /publishes no per-record page/, "the remedy is stated, not just the refusal");
    return true;
  });
});

test("#495 registration.uri is gated too — the URL COLUMN is the surface the issue is about", () => {
  const f = finding({
    owner: { name: "Kurena SA", country: "CH", registrations: [{ uri: "https://tm.corsearch.com/mark/eu/018553557" }] },
  });
  assert.throws(() => parse(f, recordOriginsFor("euipo")), /finding_record_url_foreign_host/);
  assert.equal(parse(f, recordOriginsFor("corsearch")).findings.length, 1);
});

// ── what the gate must NOT do ───────────────────────────────────────────────────────────────────────

test("#495 A RELATIVE uri PASSES — the path fragment IS the canonical record identity", () => {
  // `/mark/<cc>/<number>` is what this system stores and what the composition rule starts from. Only a
  // value that parses as an absolute http(s) URL is making a host claim worth checking. Refusing the
  // path would break every provider at once, including the ones with no public page at all.
  const f = finding({ owner: { name: "Kurena SA", country: "CH", registrations: [{ uri: "/mark/eu/018553557" }] } });
  // — EVERY provider in the table, so the one added next cannot be the one nobody checked.
  const ids = Object.keys(PROVIDERS);
  assert.ok(ids.length >= 6, `the provider table holds ${ids.length} entries — it did not load`);
  for (const id of ids)
    assert.equal(parse(f, recordOriginsFor(id)).findings.length, 1, `a bare uri path is fine on ${id}`);
});

test("#495 a COMMON-LAW finding's link is not a record URL and is never judged as one", () => {
  // A marketplace or a company site is what that source type means. Refusing those would be the gate
  // misreading its own subject, and it would fire on every common-law finding in every run.
  const f = finding({ source: { source_type: "common-law-marketplace", resolved_link: "https://www.walmart.com/ip/12345" } });
  assert.equal(parse(f, recordOriginsFor("euipo")).findings.length, 1);
});

test("#495 WITH NO PROVIDER NAMED THE GATE IS INACTIVE — replay and offline unit paths still parse", () => {
  // An archived run parsed with no provider in hand must not fail on a fact about today's deployment.
  // null and absent are the same answer; an empty ARRAY is a different one and is tested above.
  const f = finding({ source: { source_type: "register-vendor", resolved_link: "https://anything.example/mark/x" } });
  assert.equal(parse(f, undefined).findings.length, 1, "option absent");
  assert.equal(parse(f, null).findings.length, 1, "option null");
});

test("#495 an unparseable or non-http value is not a host claim and is left to the shape rules", () => {
  for (const link of ["", "not a url", "mailto:someone@example.test"]) {
    const f = finding({ source: { source_type: "register-vendor", resolved_link: link } });
    assert.equal(parse(f, recordOriginsFor("euipo")).findings.length, 1, `${JSON.stringify(link)} claims no host`);
  }
});

// ──: "COMPOSE NOTHING" NEVER NAMED THE FIELD OR THE VALUE ─────────────────────────────────────
//
// R2, 2026-08-24 (the round's codename is deliberately absent: `no-client-identifiers` refuses a
// real-shaped `<adj>-<noun>` anywhere in this tree, and it caught the first cut of this comment).
// The seat read "compose nothing / leave the `uri` as it is", took the
// second half as "pass the provider's `uri` through unmodified", and carried `/mark/ch/<guid>` into
// `source.resolved_link`. That cost a 1214-second synthesis attempt and 89K output tokens to discover a
// STATIC PROPERTY OF THE PROVIDER.
//
// The reading is fair. "Leave the `uri` as it is" is about the record's own `uri` field, but nothing in
// the doc says so, and `resolved_link` appears in NONE of the prose the seat loads — measured on that
// run's 46,541-byte dispatch, with controls passing, every term of the source contract scored zero.
// That `resolved_link` must be `""` was stated in exactly one place: the validator's error message,
// which you only see by failing it.
//
// A DOC FACT THAT LIVES ONLY IN PROSE DRIFTS BACK OUT. This arm is what makes the sentence a contract
// rather than a paragraph someone happened to write, and it is DERIVED FROM THE TABLE — a seventh
// provider that declares `hasPublicRecordUrl:false` inherits the requirement on the day it is added,
// without anyone remembering to come here. That is the same rule the `recordOriginsFor` arm above runs on.
test("#1843 every doc the seat reads names the FIELD and the VALUE, not just \"compose nothing\"", () => {
  const SKILLS = join(dirname(dirname(fileURLToPath(import.meta.url))), "skills", "prelim-register");
  const noPublicPage = Object.keys(PROVIDERS).filter((id) => PROVIDERS[id].hasPublicRecordUrl === false);
  nonEmpty(noPublicPage, "no provider declares hasPublicRecordUrl:false — this arm asserted nothing");

  // The neutral contract files load on EVERY register run, and the provider docs load for the vendor
  // actually searched. The seat can reach the decision through any of them, so all of them must answer.
  const mustSay = [
    join(SKILLS, "status-rules.md"),
    join(SKILLS, "digest.md"),
    ...noPublicPage.map((id) => join(SKILLS, "providers", `${id}.md`)),
  ];
  for (const file of mustSay) {
    const text = readFileSync(file, "utf8");
    assert.match(text, /`source\.resolved_link` is `""`/,
      `${file} tells the seat to compose nothing without naming the field or the value — the reading that `
      + "carried a bare /mark/<cc>/<id> path into resolved_link and burned a synthesis attempt");
    assert.match(text, /means do not MODIFY the record's own `uri` field/,
      `${file} must disambiguate "leave the uri as it is" — that clause is what the seat read as `
      + '"pass the uri through into the link field"');
  }
});

// ── SECOND FINDING — THE RULE WAS IN FOUR FILES THE FAILING SEAT NEVER OPENS ───────────────
//
// The first fix put the sentence in `status-rules.md`, `digest.md` and the two provider docs. All four
// live under `prelim-register/`. **The seat the validator refuses is SYNTHESIS**, and its declared
// reads are four files under `prelim-search/`. Zero overlap.
//
// So the defect reproduced on R1 with the fix in the tree — ancestry-checked, `a5315ff` present —
// costing a 1743-second synthesis attempt. Three occurrences now, and this one has an explanation
// rather than a pattern: correct prose, delivered to a reader who never opens it.
//
// THE ARM THAT WOULD HAVE CAUGHT IT, and the standard it sets: a prose fix is not landed because the
// words are right. It is landed when the STAGE THAT FAILS reads a file that carries them. That is
// derivable — `STAGES.<stage>.skillReads` declares it — so it is checked rather than assumed.
test("#1843 the record-URL rule is in a file the SYNTHESIS stage actually reads", async () => {
  const { STAGES } = await import("../stages.mjs");
  const reads = STAGES.synthesis?.skillReads;
  nonEmpty(reads ?? [], "the synthesis stage declares no skillReads — this arm cannot see what it opens");

  const SKILLS = join(dirname(dirname(fileURLToPath(import.meta.url))), "skills");
  const carrying = reads.filter((rel) => {
    const abs = join(SKILLS, rel.replace(/^skills\//, ""));
    try { return /`source\.resolved_link` is `""`/.test(readFileSync(abs, "utf8")); } catch { return false; }
  });
  assert.ok(carrying.length > 0,
    "NONE of the files synthesis reads states what `source.resolved_link` must be when a provider "
    + `publishes no per-record page. It reads:\n  ${reads.join("\n  ")}\n`
    + "The rule being correct somewhere else is what cost a 1743-second attempt with the fix already "
    + "in the tree — prose lands where the failing seat looks, or it has not landed.");
});

test("#1843 and the register seat keeps it too — this was an addition, not a move", () => {
  const SKILLS = join(dirname(dirname(fileURLToPath(import.meta.url))), "skills");
  for (const rel of ["prelim-register/status-rules.md", "prelim-register/digest.md"]) {
    assert.match(readFileSync(join(SKILLS, rel), "utf8"), /`source\.resolved_link` is `""`/,
      `${rel} lost the rule. The register seat composes these links and needs it as much as synthesis does; `
      + "moving prose from one reader to another trades one silent failure for a different one.");
  }
});

// The refusal a seat actually meets must carry the same remedy the docs now carry. If they drift apart,
// the doc is teaching one thing and the gate is demanding another — which is this issue with the sides
// swapped.
test("#1843 the validator's refusal states the same remedy the docs do", () => {
  // Through this file's own `parse` helper, so the document wrapper and the origins argument are the
  // shapes every other arm here uses — a hand-built call is how the first cut of this arm asserted a
  // key-shape error instead of the refusal it was written for.
  const f = finding({ source: { source_type: "register-vendor", resolved_link: "/mark/ch/SWITI637BA1ED0C6611F1B566005056" } });
  assert.throws(() => parse(f), (e) => {
    assert.match(e.message, /finding_record_url_not_a_link/);
    assert.match(e.message, /leave it "" and cite the office register in the text/,
      "the refusal is the only place this value was written down before #1843 — it must keep saying it");
    return true;
  });
});
