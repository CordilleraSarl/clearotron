// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// record-links-honour-the-allowlist.test.mjs —: a record link resolves, or it is not a link.
//
// THE DEFECT WAS A REFUSAL THAT WAS COMPUTED AND THEN BYPASSED. `record-origins.mjs` returns `[]` for a
// provider that publishes no per-record page; `publish/index.mjs` turns that into `recordOrigin = null`;
// and `render.mjs` read `RECORD_ORIGIN || provOrigin`, where `provOrigin` was scraped from the finding's
// own `source.resolved_link`. So the `||` handed the job to whatever host happened to be in that link.
//
// ── HOW A FOREIGN ORIGIN SURVIVED TO BE SCRAPED, read from the code rather than assumed ────────────
//
// `normalizeRecordLinks` already repairs foreign ABSOLUTE links — but only on findings whose
// `source_type` starts with `register`, which is correct: a common-law link is not a record claim.
// `SOURCE_TYPES` (findings-model.mjs) also carries `common-law-marketplace`, `common-law-web` and
// `case-law`. A finding sourced from a web page therefore keeps its link, the scrape took THAT origin,
// and every `/mark/<cc>/<id>` on the card was prefixed with it. The repair was scoped to register
// sources; the scrape was scoped to nothing. That asymmetry is what these arms pin.
//
// ── AND WHAT A CARD SHOWS WHERE A LINK CANNOT GO (owner ruling, 2026-08-20) ────────────────────────
//
// Per provider, and the doctrine lives in the PROVIDER TABLE rather than in a branch on a vendor name
// inside the renderer: `workbook` (no register UI exists — point at the artifact that does carry the
// record) or `placeholder` (a UI exists, its per-record address is unknown — say so, and say it is
// unfinished). A constructed URL for a provider that publishes none would be a fabricated citation on
// a legal deliverable, and the ruling forbids it in those words.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { recordOriginsFor } from "../record-origins.mjs";
import { PROVIDERS } from "../driver.config.mjs";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (p) => readFileSync(join(REPO, p), "utf8");

/**
 * The file's CODE, comments removed.
 *
 * Needed because these arms forbid a string that the fix's own comments quote in order to explain what
 * was wrong — the canary problem, and the first version of this file failed on exactly that: two arms
 * fired on the paragraphs describing the defect they exist to prevent. Matching raw source would force
 * the fix to be undocumented to stay green, which is the wrong trade every time.
 * (Same technique as repair-composer-registry.test.mjs, for the same reason.)
 */
const code = (p) => read(p).split("\n").filter((l) => !l.trimStart().startsWith("//")).join("\n");

// ── the allow-list itself, which the render now depends on ─────────────────────────────────────────

test("#1438 the allow-list already answered correctly — the defect was downstream of it", () => {
  // Stated as a precondition rather than assumed: if these move, the fix below is aimed at the wrong
  // thing. `[]` is an ANSWER (this provider publishes no record page), distinct from `null` (no
  // provider named), and record-origins.mjs says so at length.
  assert.deepEqual(recordOriginsFor("signa"), [], "signa publishes no per-record page");
  assert.deepEqual(recordOriginsFor("clarivate"), [], "clarivate publishes no per-record page");
  assert.deepEqual(recordOriginsFor("corsearch"), ["https://tm.corsearch.com"]);
  assert.deepEqual(recordOriginsFor("euipo"), ["https://euipo.europa.eu"]);
  const freeTier = recordOriginsFor("free-tier");
  assert.ok(freeTier.length >= 2,
    `a composite resolves through its MEMBERS, so it has several origins and no single one to guess: ${JSON.stringify(freeTier)}`);
});

// ── the fix, at the site that was bypassing it ─────────────────────────────────────────────────────

test("#1438 THE SCRAPED ORIGIN IS GONE — render.mjs no longer takes a host from a finding's source link", () => {
  const src = code("driver/publish/render.mjs");
  assert.doesNotMatch(src, /RECORD_ORIGIN \|\| provOrigin/,
    "the `||` fallback is back: a provider whose allow-list is empty will be linked onto whatever host "
    + "its source link happens to carry, which is the whole defect");
  assert.doesNotMatch(src, /provOrigin/,
    "`provOrigin` still exists somewhere in this file — the scrape is the mechanism, not just its use");
  assert.match(src, /RECORD_ORIGINS = Array\.isArray\(opts\.recordOrigins\)/,
    "the renderer must receive the run's allow-list, not one derived origin");
});

test("#1438 the SAME list reaches both consumers — one allow-list, not two derivations", () => {
  const idx = read("driver/publish/index.mjs");
  // normalizeRecordLinks repairs absolute links; render constructs from paths. Before this both had
  // their own idea of what was legitimate, which is how one could refuse while the other allowed.
  assert.match(idx, /normalizeRecordLinks\(findings, runOrigins\)/);
  assert.match(idx, /recordOrigins: runOrigins/,
    "render must be handed the SAME runOrigins the repair pass uses — a second derivation is a second "
    + "chance to disagree");
});

// ── the link RULE, read off the resolver ───────────────────────────────────────────────────────────
//
// SOURCE-TEXT, AND THE LIMIT SAID OUT LOUD. `renderHtml` needs a whole parsed report to run, and what
// is under test is one resolver — so these arms read `regHref` rather than rendering a card. That means
// they pin the RULE and not the rendered bytes: a change that satisfied these and still emitted a bad
// href would pass. The rendered-output half is covered where it belongs, by the publish suites that
// already drive a full report end to end.
//
// The shape that produced the bug, for the next reader: a finding with
// `source.source_type: "common-law-web"` and a legitimate marketplace `resolved_link`, whose owner
// carries `registrations: [{ uri: "/mark/us/usafi0ac…" }]`. The link is not a record claim, so the
// repair pass correctly leaves it — and the scrape took its origin anyway.

test("#1438 A BARE RECORD PATH LINKS ONLY UNDER A SINGLE ALLOW-LISTED ORIGIN", () => {
  // Read from the source of regHref rather than by rendering a whole report: the render entry point
  // needs a full parsed report, and what is under test is one resolver. The RULE is what must hold.
  const src = code("driver/publish/render.mjs");
  const at = src.indexOf("const regHref = (u) =>");
  assert.ok(at > 0, "regHref moved — this arm reads it by name");
  const body = src.slice(at, src.indexOf("const regUri", at));
  assert.match(body, /singleOrigin/,
    "a bare path may only take an origin when the allow-list names exactly ONE — with two (a composite: "
    + "EUIPO + USPTO) choosing one is a guess, and a guessed citation is what this issue exists to stop");
  assert.match(body, /allowed\(u\)/,
    "an already-absolute URI must be checked against the list, not passed through");
});

test("#1438 `[]` AND `null` MEAN DIFFERENT THINGS and the render must not collapse them", () => {
  const src = code("driver/publish/render.mjs");
  // `[]` = this provider publishes nothing, so nothing links. `null` = no provider named (a legacy or
  // receipt-less run), so there is no list to judge by. Collapsing them either strips legitimate links
  // off every archived run or lets the defect back in through the null door.
  assert.match(src, /Array\.isArray\(RECORD_ORIGINS\)\) return true;/,
    "with no allow-list, an absolute URI is left as written — the same posture normalizeRecordLinks takes");
  const at = src.indexOf("const regHref = (u) =>");
  const body = src.slice(at, src.indexOf("const regUri", at));
  assert.match(body, /Array\.isArray\(RECORD_ORIGINS\) \? null : RECORD_ORIGIN/,
    "and with no allow-list nothing is CONSTRUCTED from a path either — an unlisted run must not gain "
    + "links it did not have (acceptance: a republish introduces none)");
});

// ── what the reader gets where a link cannot go ────────────────────────────────────────────────────

test("#1438 THE PER-PROVIDER RULING LIVES IN THE PROVIDER TABLE, not in a vendor branch in the renderer", () => {
  assert.equal(PROVIDERS.signa.recordCitation, "workbook",
    "signa has no register UI at all — the card points at the artifact that carries the record");
  assert.equal(PROVIDERS.clarivate.recordCitation, "placeholder",
    "clarivate has a UI whose per-record address is unknown — labelled as unfinished, never as a citation");
  for (const id of ["corsearch", "euipo"]) {
    assert.equal(PROVIDERS[id].recordCitation, undefined,
      `${id} links and its links resolve — a citation note there would be noise`);
  }
  // Both directions: a provider that publishes no record page and says nothing about what to show
  // instead leaves the reader a bare internal identifier. That is the state before this issue.
  for (const [id, conf] of Object.entries(PROVIDERS)) {
    if (conf.hasPublicRecordUrl === false) {
      assert.ok(["workbook", "placeholder"].includes(conf.recordCitation),
        `${id} publishes no record page and declares no recordCitation — its cards would show a bare `
        + `/mark/<cc>/<id> with nowhere to go, which is the half of #1438 the link fix does not cover`);
    }
  }
});

test("#1438 the workbook is named IN THE WORDS THE READER SEES, and not as an inline .xlsx link", () => {
  const src = read("driver/publish/render.mjs");
  const label = read("portal-ui/src/screens/Result.tsx").match(/Download full audit \(Excel\)/);
  assert.ok(label, "the portal's own download control no longer carries that label — the note below now "
    + "points a reader at a string that is not on the page");
  assert.match(src, /Download full audit \(Excel\)/,
    "the workbook note must quote the control's own label; a reader hunts for the words on the button");
  // An inline .xlsx anchor would be stripped by portal-report.mjs — correctly, because the portal
  // REPLACES it with its own control. Adding one back would be a link that vanishes inside the portal.
  const at = src.indexOf("const NO_LINK_NOTE");
  assert.doesNotMatch(src.slice(at, at + 400), /\.xlsx/,
    "the note must not contain an inline .xlsx link — the portal strips those and the reader would be "
    + "left with a named file and no way to reach it");
});

test("#1438 the strip's justification is no longer false — it cost the last reader a wrong conclusion", () => {
  const src = read("driver/portal-report.mjs");
  assert.doesNotMatch(src, /internal by standing policy, and the portal does not serve the file/,
    "the stale justification is back. Both halves are false — portal-service.mjs serves the workbook and "
    + "portal-ui offers it — and reading them as true is what produced a withdrawn blocker on #1438");
  assert.match(src, /REPLACED, not removed/,
    "the comment must state the real reason: the portal offers a better affordance in its own chrome");
  // Independently verified rather than taken on the thread's word.
  assert.match(read("driver/portal-service.mjs"), /parts\[3\] === "audit\.xlsx"/, "the route serves it");
  assert.match(read("portal-ui/src/screens/Result.tsx"), /audit\.xlsx/, "and the UI offers it");
});
