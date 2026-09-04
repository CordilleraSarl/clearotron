// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// scrub.test.mjs — the CLIENT VIEW of an artifact ( R1).
//
// THE PROPERTY UNDER TEST, stated as the product rule: what a client principal reads over MCP is what the
// delivered client report already shows them — no more, AND NO LESS.
//
// The "no less" half is not padding, it is the point. The obvious-looking fix here is a blocklist that
// strips anything mentioning a vendor or the methodology. That fix is WRONG and this file is what stops
// someone rebuilding it: publish/render.mjs renders the Methodology section to the client (scopeSection →
// plainScopeNote) and deliberately names the register provider (provenance honesty / receipts / enforcement
// telemetry). A scrubber stricter than the report would delete content the client was already sent and make
// the MCP a different product from the report in their inbox. If you are here because an assertion in
// "client content SURVIVES" failed: the scrubber got too aggressive — that is the regression, not the test.
//
// Fixture is a verbatim excerpt of a REAL run's report.md (see fixtures/report.internal.md provenance
// header) — house rule: invented fixtures certify the bug, because they only carry the shapes you thought of.

import { test, before, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const INTERNAL = readFileSync(join(HERE, "fixtures", "report.internal.md"), "utf8");

let scrubMarkdown, scrubBody, scrubFrontMatter, scrubCards, parseFront, parseBlocks, buildAuditMd;
let parseSpineFindingBlocks, mintContradictionDoubts, stitchDoubts;
before(async () => {
  ({ scrubMarkdown, scrubBody, scrubFrontMatter, scrubCards } = await import("../lib/scrub.mjs"));
  ({ parseFront, parseBlocks, buildAuditMd } = await import("../lib/driver.mjs"));
  // — the doubt minter and its spine parser are not part of the MCP's coupling surface (lib/driver.mjs
  // stays the ONE import point for what the server uses). These are test-only, so they come straight from
  // the driver rather than widening that file for a fixture.
  ({ parseSpineFindingBlocks } = await import("../../driver/publish/audit-from-spine.mjs"));
  ({ mintContradictionDoubts, stitchDoubts } = await import("../../driver/doubt-ledger.mjs"));
});

// — synthetic spine with INVENTED marks/owners, the shape driver/test/audit-from-spine.test.mjs uses:
// an asserted finding block and its direct-search refutation about one mark, so buildAuditMd stamps BOTH
// `- resolution:` and `- contradiction_resolution:` from real code rather than from a literal.
const CONTRA_SPINE_MD = [
  "# Register findings — Mark: VOLTMAX",
  "",
  "### Watchlist annex",
  "| Mark | Owner | Status | Notes |",
  "|---|---|---|---|",
  "| VOLTMAX ENERGYCORE | NutriVolt Beverages, Inc. | live | CRITICAL FINDING: active commercial product with nationwide distribution via retail channels |",
  "| Kestrel Hydration (VOLTMAX ENERGYCORE NOT found) | Kestrel Hydration LLC | n/a | direct search of nutrivolt.example: VOLTMAX ENERGYCORE does NOT appear as a product name on official NutriVolt sites |",
].join("\n");
const ADVERSARIAL_FINDING = {
  ordinal: 7, mark: "VOLTMAX ENERGYCORE", band: "MEDIUM",
  owner: { name: "NutriVolt Beverages, Inc.", country: "US" },
  disposition: "adversarial",
};
const OFF_FIELD_FINDING = { ...ADVERSARIAL_FINDING, band: undefined, disposition: "off-field" };

describe("scrub: internal-only content is REMOVED", () => {
  test("the `- [internal]` reasoning bullets do not survive", () => {
    assert.match(INTERNAL, /- \[internal\]/, "fixture must actually carry the shape (guard against a hollow test)");
    const out = scrubMarkdown(INTERNAL);
    assert.ok(!out.includes("[internal]"), "an [internal] label reached the client view");
    // the BODY of an internal bullet must go too, not just its label
    assert.ok(!/enforcer basis is inferred from portfolio signals/i.test(out),
      "internal reasoning text survived with its label stripped");
  });

  test("no raw ::p:: marker survives", () => {
    const out = scrubBody("public head ::p:: internal tail");
    assert.equal(out.trim(), "public head");
    assert.ok(!scrubMarkdown(INTERNAL).includes("::p::"));
  });

  test("the internal band code (overall_badge) is dropped from front matter", () => {
    const { fm } = parseFront(INTERNAL);
    assert.equal(fm.overall_badge, "l4", "fixture must carry the internal code");
    assert.equal(scrubFrontMatter(fm).overall_badge, undefined);
    assert.ok(!/overall_badge/.test(scrubMarkdown(INTERNAL)));
  });

  test("the framework PROFILE HASH is dropped, the framework TITLE stays", () => {
    const { fm } = parseFront(INTERNAL);
    assert.match(fm.rated_under, /profile d37721cda899/, "fixture must carry the profile hash");
    const scrubbed = scrubFrontMatter(fm).rated_under;
    assert.ok(!/profile d37721cda899/.test(scrubbed), "the config profile hash leaked");
    assert.match(scrubbed, /house default framework/, "the client-facing framework title should survive");
  });

  test("a custom framework's SOURCE FILENAME is dropped, its human title stays", () => {
    // shape taken from a real run (TMP8743): `<customer> · custom framework: <title> (<file>.md) · profile <hash>`
    const out = scrubFrontMatter({
      rated_under: "Aurora Interactive (aurora) · custom framework: ACP risk framework (risk-framework-aurora.md) · profile 890f610e1dcf",
    }).rated_under;
    assert.ok(!/\.md/.test(out) && !/890f610e1dcf/.test(out), `config identity leaked: ${out}`);
    assert.match(out, /ACP risk framework/);
    assert.match(out, /Aurora Interactive/);
  });

  test("front matter is an ALLOWLIST — an unknown future key is withheld by default", () => {
    const out = scrubFrontMatter({ title: "ACME", some_new_internal_key: "engine detail" });
    assert.equal(out.title, "ACME");
    assert.equal(out.some_new_internal_key, undefined, "a new key leaked — the allowlist inverted to a blocklist");
  });

  test("curated cards drop the internal tier/label shorthand but KEEP group", () => {
    const cards = [{ who: "X", group: "on-field", tier: "B", label: "Composite 3", one: "…", read: "…" }];
    const [c] = scrubCards(cards);
    assert.equal(c.tier, undefined);
    assert.equal(c.label, undefined);
    assert.equal(c.group, "on-field", "group is the client report's own section vocabulary — must NOT be stripped");
    assert.equal(c.read, "…");
  });

  // D5 — the report's risk chip stopped printing `disposition`, and this is the other door it left
  // through. It is not a rating: stages.mjs dictates it as the posture that sets only WHERE a card is
  // placed. `group` already carries that fact in the client report's own heading words.
  test("#762: disposition is stripped — the placement key never reaches a client, on either surface", () => {
    const [c] = scrubCards([{ who: "X", group: "on-field", disposition: "adversarial", one: "…" }]);
    assert.equal(c.disposition, undefined, "the engine's placement word left over list_findings");
    assert.equal(c.group, "on-field", "…and the client-vocabulary equivalent is untouched");
  });

  // THE INPUT IS REAL, not hypothetical — a rule no input can reach is a claim nobody can check.
  // buildAuditMd stamps `- disposition: withdrawn` onto any audit block that joins a withdrawn finding
  // (audit-from-spine.mjs; predelivery-lint.mjs depends on the stamp), parseBlocks turns every `- k: v`
  // line into a key, and server.mjs pipes list_findings items straight through scrubCards.
  // SUPERSEDED IN PART BY, and rewritten rather than deleted. This arm was about the audit-block
  // SHAPE — the object parseBlocks actually produces — reaching the strip at all. Its withdrawn example
  // is no longer stripped-and-served, it is not served, so the shape claim is made on a live block and
  // the withdrawn one is asserted absent.
  test("#762: the audit-block shape that actually carries it is the shape this strips", () => {
    const [c] = scrubCards([{ _title: "PROPEL AQUAPLUS", disposition: "adversarial", one: "…" }]);
    assert.equal(c.disposition, undefined);
    assert.equal(c._title, "PROPEL AQUAPLUS", "the block itself is not otherwise touched");
    assert.deepEqual(
      scrubCards([{ _title: "PROPEL AQUAPLUS", disposition: "withdrawn", withdrawn_reason: "confabulated attribution" }]),
      [], "a withdrawn block is no longer stripped-and-served, it is not served (#1187)");
  });

  // ── — THE TWO KEYS THE NAME-KEYED STRIP COULD NOT SEE ─────────────────────────────────────────
  //
  // These arms replace the OPEN arm this file carried while was filed. THE INPUT IS THE BUILDER'S
  // OWN OUTPUT, not an object literal: buildAuditMd → parseBlocks → scrubCards is the exact chain
  // server.mjs runs for list_findings, so the KEY NAMES are checked rather than assumed. A transform
  // keyed on a name parseBlocks does not produce would pass green against a hand-written fixture.
  const auditCards = (findings, doubts = null) => {
    const { md } = buildAuditMd(CONTRA_SPINE_MD, "", { findings, doubts });
    const findingsSection = md.split(/^# Negative Results$/m)[0].replace(/^# Findings\n/, "");
    return parseBlocks(findingsSection);
  };

  test("#831: `resolution` loses the placement word and KEEPS the pointer", () => {
    const raw = auditCards([ADVERSARIAL_FINDING]).find((b) => b.resolution);
    assert.ok(raw, "premise: the builder stamps a resolution line on this shape");
    assert.equal(raw.resolution, "adversarial / MEDIUM — see finding #7",
      "premise: it opens with the engine's placement word");

    const [c] = scrubCards([raw]);
    assert.doesNotMatch(c.resolution, /adversarial/i, "the placement word left over list_findings");
    assert.equal(c.resolution, "MEDIUM — see finding #7",
      "the band and the cross-reference survive — deleting the key would delete the pointer with the word");
  });

  test("#831: a resolution with NO band keeps its cross-reference too", () => {
    const raw = auditCards([OFF_FIELD_FINDING]).find((b) => b.resolution);
    assert.equal(raw.resolution, "off-field — see finding #7", "premise: off-field carries no band");
    assert.equal(scrubCards([raw])[0].resolution, "see finding #7",
      "the pointer is the whole client value here — it must not be emptied");
  });

  test("#831: `contradiction_resolution` loses the word from inside the finding reference", () => {
    const blocks = parseSpineFindingBlocks(CONTRA_SPINE_MD, "");
    const doubts = stitchDoubts(mintContradictionDoubts(blocks), { findings: { findings: [ADVERSARIAL_FINDING], actions: [] } });
    const raw = auditCards([ADVERSARIAL_FINDING], doubts).filter((b) => b.contradiction_resolution);
    assert.equal(raw.length, 2, "premise: BOTH fragments of the pair carry the annotation");
    assert.match(raw[0].contradiction_resolution, /\(finding #7, adversarial\)/, "premise: the word is inside the reference");

    for (const c of scrubCards(raw)) {
      assert.doesNotMatch(c.contradiction_resolution, /adversarial/i, "the placement word left inside a contradiction line");
      assert.match(c.contradiction_resolution, /\(finding #7\)/, "the finding reference survives without it");
      assert.match(c.contradiction_resolution, /supports "/, "…and so does which fragment the record supports");
    }
  });

  // 's lesson, as an arm rather than a promise: these rules match a POSITION in a grammar this engine
  // writes, never a word anywhere in a string it does not. A trademark spelled like a disposition survives.
  test("#831: a MARK that spells a disposition is untouched — this is not a ban list", () => {
    const [c] = scrubCards([{
      _title: "ADVERSARIAL",
      resolution: "adversarial / MEDIUM — see finding #3",
      result_summary: "ADVERSARIAL is a live EUTM; the adversarial posture of its owner is not in issue.",
    }]);
    assert.equal(c._title, "ADVERSARIAL", "the mark itself is not a vocabulary hit");
    assert.match(c.result_summary, /ADVERSARIAL is a live EUTM/, "prose the client keeps is not rewritten");
    assert.match(c.result_summary, /the adversarial posture/, "…including a mid-sentence use of the same word");
    assert.equal(c.resolution, "MEDIUM — see finding #3", "only the anchored position moves");
  });

  test("#831: a block carrying neither key gains neither — absent stays absent, never null", () => {
    const [c] = scrubCards([{ _title: "X", result_summary: "…" }]);
    assert.ok(!("resolution" in c), "a key the block never had must not materialise");
    assert.ok(!("contradiction_resolution" in c), "…nor this one");
  });
});

describe("scrub: client content SURVIVES (the anti-over-scrub half)", () => {
  const out = () => scrubMarkdown(INTERNAL);

  test("the Methodology section survives — the client report renders it too", () => {
    assert.match(out(), /^# Methodology/m,
      "Methodology was dropped. The client report SHOWS it (render.mjs scopeSection → plainScopeNote); " +
      "stripping it here makes MCP stricter than the delivered report.");
    assert.match(out(), /edit-1 \/ form-neighbourhood band/, "methodology prose was gutted");
  });

  test("provider names survive — the client report names them deliberately", () => {
    assert.match(out(), /Corsearch/,
      "a provider name was stripped. render.mjs names the provider to the client on purpose " +
      "(provenance honesty :193, receipts :1026, enforcement telemetry :1105).");
    assert.match(out(), /perplexity_research/, "the common-law provider was stripped from ordinary prose");
    assert.match(out(), /tm\.corsearch\.com/, "the Source: provenance link was rewritten or dropped");
  });

  test("the legal product survives intact", () => {
    const o = out();
    assert.match(o, /### The read/, "card structure lost");
    assert.match(o, /Under the framework established in \*Canon\*/, "legal reasoning prose lost");
    assert.match(o, /- Source: \[Corsearch/, "provenance line lost");
    assert.match(o, /^## Doruk İlkay/m, "the conflict card heading lost");
    assert.match(o, /overall_caption:/, "the client-facing caption lost");
    assert.match(o, /^# Actions/m, "the Actions section lost");
  });

  test("a sentence that merely LOOKS engine-ish is not collateral damage", () => {
    // class-9 goods prose and a conflict mark named MCP must survive the engine-internal filter
    const kept = scrubBody("The goods are wireless, not wired. MCP Corp owns the cited mark.");
    assert.match(kept, /wireless, not wired/);
    assert.match(kept, /MCP Corp/);
  });
});

describe("scrub: document shape", () => {
  test("front matter is re-emitted as valid, re-parseable front matter", () => {
    const { fm } = parseFront(scrubMarkdown(INTERNAL));
    assert.equal(fm.title, "VENZY");
    assert.equal(fm.overall_label, "High");
    assert.equal(fm.overall_badge, undefined);
  });

  test("a document with no front matter (client-summary) is body-scrubbed alone", () => {
    const out = scrubMarkdown("Some client summary. ::p:: internal aside");
    assert.ok(!out.startsWith("---"), "invented a front-matter block that was not there");
    assert.match(out, /Some client summary/);
    assert.ok(!out.includes("::p::"));
  });

  test("scrubbing is idempotent", () => {
    const once = scrubMarkdown(INTERNAL);
    assert.equal(scrubMarkdown(once), once);
  });
});

// ── — THE REVIEWER'S JUDGMENT ABOUT OUR OWN OUTPUT NEVER REACHES A CLIENT ───────────────────────
//
// A third class, and it needed its own ruling rather than a quiet addition to the strip list.
//
// Everything the scrubber handled before was the ENGINE'S SPELLING OF A FACT THE CLIENT ALREADY HAS:
// `disposition` says what the section heading says, `tier`/`label` are the risk chip's shorthand,
// `resolution` keeps its pointer and loses its vocabulary. `withdrawn_reason` is the reviewer's verdict
// on the engine — "confabulated attribution" — about a finding the client is NEVER SHOWN, because a
// withdrawn finding renders nowhere. publish/report-data.mjs already refuses to carry it for exactly
// that reason. The two client surfaces disagreed about one field; they now agree.
describe("scrub: #903 withdrawn_reason", () => {
  test("#903 withdrawn_reason is STRIPPED from a curated card — it has no client-meaningful residue", () => {
    // now drops the whole block when it is marked withdrawn, so the KEY strip is tested on the
    // shape that can still reach a client: an ORPHANED withdrawn_reason. findings-model.mjs:1258 calls
    // that a shape error ("withdrawn_reason is only valid when disposition is withdrawn") and throws on
    // it at the source — which is exactly why the scrub keeps its own arm. Defence in depth: if the
    // stamp is ever absent while the reason is present, the block drop cannot fire and this must.
    const [c] = scrubCards([{
      _title: "PROPEL AQUAPLUS", group: "on-field",
      withdrawn_reason: "confabulated attribution", one: "…",
    }]);
    assert.equal(c.withdrawn_reason, undefined,
      "the reviewer's QC judgment on our own output left over list_findings");
    assert.equal(c.group, "on-field", "client vocabulary is untouched — the 'no less' half of the rule");
    assert.equal(c.one, "…");
    // And the stamped case, which removes entirely rather than softening.
    assert.deepEqual(scrubCards([{ _title: "X", disposition: "withdrawn", withdrawn_reason: "confabulated attribution" }]), []);
  });

  test("#903 stripped, NOT transformed — unlike resolution, there is no pointer to keep", () => {
    // resolution/contradiction_resolution are rewritten rather than dropped because each carries a
    // client-meaningful cross-reference. This one carries an assessment of our own confabulation.
    const [c] = scrubCards([{ _title: "X", withdrawn_reason: "confabulated product page; owner-site search found no such product" }]);
    assert.equal("withdrawn_reason" in c, false,
      "a transformed key would still be PRESENT with softened prose — this one must be absent");
  });

  test("#903 an absent key stays absent — the scrub never invents one", () => {
    const [c] = scrubCards([{ _title: "X", group: "on-field" }]);
    assert.equal("withdrawn_reason" in c, false);
  });

  test("#903 THE ISSUE'S OWN JUDGING METHOD: buildAuditMd \u2192 parseBlocks \u2192 scrubCards, end to end", () => {
    // says how to judge it, and this is that \u2014 on the REAL builder, over the same synthetic spine
    // uses, rather than a hand-made card. audit-from-spine.mjs stamps the reviewer's prose onto any
    // block that joins a withdrawn finding, and that join is done by real code here.
    const REASON = "confabulated attribution \u2014 no source ties this registration to the named owner";
    const WITHDRAWN_FINDING = { ...ADVERSARIAL_FINDING, disposition: "withdrawn", withdrawn_reason: REASON };

    const { md } = buildAuditMd(CONTRA_SPINE_MD, "", { findings: [WITHDRAWN_FINDING] });
    // PREMISE, asserted rather than assumed. If the builder ever stops stamping this, the assertions
    // below start passing for the wrong reason \u2014 which is the shape was filed about one level over.
    assert.ok(md.includes(REASON),
      "premise gone: buildAuditMd no longer stamps withdrawn_reason at all \u2014 re-read #903 before deleting this");

    const blocks = parseBlocks(md.split(/^# Negative Results$/m)[0].replace(/^# Findings\n/, ""));
    assert.ok(blocks.some((b) => b.withdrawn_reason),
      "premise gone: parseBlocks no longer turns the stamped line into a key");

    const client = scrubCards(blocks);
    for (const b of client) {
      assert.equal(b.withdrawn_reason, undefined, `the reason survived on block ${JSON.stringify(b._title)}`);
      assert.equal(b.disposition, undefined, `the withdrawal word survived on block ${JSON.stringify(b._title)}`);
    }
    // And the prose is gone from EVERY value, not just from that key. A builder composing a stripped
    // field into a surviving one is precisely how was missed, and an allowlist keyed on names
    // cannot see it.
    assert.ok(!JSON.stringify(client).includes("confabulated"),
      `reviewer prose reached the client view through another key:\n${JSON.stringify(client, null, 2)}`);
  });

  test("#903 the two client surfaces now answer the same question the same way", () => {
    // report-data.mjs's ruling, on its own surface: only LIVE findings, and no withdrawn_reason. The MCP
    // used to hand over what the data file refused to write. The comparison is the point of the fix.
    const withdrawn = { _title: "X", disposition: "withdrawn", withdrawn_reason: "confabulated attribution" };
    // made the agreement TOTAL: report-data.mjs drops the FINDING and the MCP now drops its
    // BLOCK, so nothing about a withdrawn finding reaches either client surface.
    assert.deepEqual(scrubCards([withdrawn]), []);
    const dataSurface = readFileSync(join(HERE, "..", "..", "driver", "publish", "report-data.mjs"), "utf8");
    assert.match(dataSurface, /no withdrawn_reason/,
      "report-data.mjs no longer states the ruling this fix was aligned to — if that surface changed, "
      + "these two can disagree again and #903 is back");
  });
});

// ── — A WITHDRAWN FINDING'S BLOCK IS NOT SERVED AT ALL ─────────────────────────────────────────
//
// stopped the reviewer's REASON reaching a client. It left something worse behind, and this closes
// it: the block itself was still served, with BOTH markers of the withdrawal stripped on the way out —
// `disposition` by D5, `withdrawn_reason` by. Every signal that it should not be there was
// exactly the set we removed, so it read as live.
//
// The ruling did not need a new product decision, because the product had already made it:
// driver/publish/report-data.mjs:64 filters to live findings only, "a withdrawn finding renders nowhere
// — it does not exist here either". Two client surfaces, one question, two answers. Option 1:
// they agree by construction.
//
// NOTE WHAT DOES *NOT* CHANGE: the audit markdown keeps the block and keeps the stamp.
// predelivery-lint.mjs depends on `- disposition: withdrawn` being there to catch a withdrawn finding
// resurrected in the report. The internal record is complete; the client view is filtered.
describe("scrub: #1187 the withdrawn block is not served", () => {
  test("#1187 scrubCards DROPS a withdrawn block and keeps the live ones", () => {
    const out = scrubCards([
      { _title: "LIVE ONE", group: "on-field", one: "…" },
      { _title: "KILLED", group: "on-field", disposition: "withdrawn", withdrawn_reason: "confabulated attribution" },
      { _title: "ALSO LIVE", group: "off-field", disposition: "adversarial", one: "…" },
    ]);
    assert.deepEqual(out.map((c) => c._title), ["LIVE ONE", "ALSO LIVE"],
      "a block for a finding the client is never shown was served to them");
    // The other dispositions are STRIPPED, not dropped — only the withdrawal removes the record. A card
    // whose posture is 'adversarial' is a live finding on the client's report.
    assert.equal(out[1].disposition, undefined);
  });

  test("#1187 THE END-TO-END SHAPE THE RULING NAMES: present in the audit md, ABSENT from the client view", () => {
    const REASON = "confabulated attribution — no source ties this registration to the named owner";
    const WITHDRAWN = { ...ADVERSARIAL_FINDING, disposition: "withdrawn", withdrawn_reason: REASON };
    const { md } = buildAuditMd(CONTRA_SPINE_MD, "", { findings: [WITHDRAWN] });

    // HALF ONE — the internal record keeps everything. predelivery-lint.mjs greps for this stamp to
    // catch a withdrawn finding resurrected in the report; a fix that removed it here would break that.
    assert.ok(md.includes("- disposition: withdrawn"), "the audit md must KEEP the stamp — predelivery-lint reads it");
    assert.ok(md.includes(REASON), "and the reviewer's reason stays in the internal record");

    // HALF TWO — the client view carries no trace of the block.
    const blocks = parseBlocks(md.split(/^# Negative Results$/m)[0].replace(/^# Findings\n/, ""));
    const withdrawnTitles = blocks.filter((b) => b.disposition === "withdrawn").map((b) => b._title);
    assert.ok(withdrawnTitles.length, "premise gone: the builder stamped no block withdrawn on this spine");

    const client = scrubCards(blocks);
    for (const t of withdrawnTitles) {
      assert.ok(!client.some((c) => c._title === t), `the withdrawn block ${JSON.stringify(t)} reached the client view`);
    }
    assert.ok(!JSON.stringify(client).includes("confabulated"), "reviewer prose survived somewhere in the client view");
  });

  test("#1187 the two client surfaces now agree BY CONSTRUCTION, not key by key", () => {
    // report-data.mjs filters the whole finding out; scrubCards now does the same for its block. The
    // point of the ruling was that a key-by-key allowlist is what keeps letting one through.
    const dataSurface = readFileSync(join(HERE, "..", "..", "driver", "publish", "report-data.mjs"), "utf8");
    assert.match(dataSurface, /disposition !== 'withdrawn'|disposition !== "withdrawn"/,
      "report-data.mjs no longer filters withdrawn findings — the surfaces can disagree again");
  });
});
