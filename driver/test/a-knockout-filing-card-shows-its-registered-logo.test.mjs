// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// A KNOCKOUT'S REGISTER FILING CARD SHOWS THAT FILING'S LOGO (owner, 2026-11-25). The logo sat only in the filings table;
// the card a lawyer reads first carried none. Each filing card now holds one "Register" frame with that filing's logo
// where the run fetched one, captioned with its register and opening the office's record, and the logo step asks about
// the filings the cards draw beside the table's rows. A finding's card has no Register frame. Invented names only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { renderKnockoutHtml, cardFilings, picturesForNamePage } from "../publish/render-knockout.mjs";
import { parseFrameworkManifest } from "../framework.mjs";
import { citedRefs } from "../mark-logos.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const RUN = join(HERE, "fixtures", "report-pages", "knockout-with-findings", "run");
const read = (p) => JSON.parse(readFileSync(join(RUN, p), "utf8"));
const findings = read("knockout-findings.json");
const registerRecords = read("_driver/register-records.json");
const framework = parseFrameworkManifest(read("_driver/framework.json"));
const EU = "/mark/eu/00000000-0000-4000-8000-000000000001";
const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082", "hex");
const saved = { uri: EU, provider: "fixture", office: "em", applicationNumber: "000000001", registrationNumber: "000000001", statusText: "REGISTERED",
  markText: "TALVOREN", markFeature: "WORD AND DESIGN", imageAvailable: true, owner: "Talvoren Systems", ownerCountry: "DE" };

test("a filing card holds its filing's logo in a Register frame, under its meta line; a finding's card holds none", () => {
  const html = renderKnockoutHtml(findings, framework, { registerRecords, filingRecords: new Map([[EU, saved]]),
    logos: new Map([[EU, { state: "fetched", src: `data:image/png;base64,${PNG.toString("base64")}` }]]) });
  const card = html.match(/<div class="card ko-find"[^>]*>(?:(?!<div class="card ko-find")[\s\S])*?<h3 class="who">TALVOREN<\/h3>[\s\S]*?<p class="ko-findnet">/)?.[0] ?? "";
  assert.ok(card, "the TALVOREN filing card is not drawn");
  assert.match(card, /<p class="ko-findmeta">[^<]*<\/p>\s*<div class="pic-line"><div class="pic-set"><div class="pic-head"><span class="pic-lab">Register<\/span><\/div><div class="rr-logos rr-band"><figure class="rr-lg">[\s\S]*?<img src="data:image\/png;base64,[^"]+" alt="[^"]+">[\s\S]*?<figcaption>EU<\/figcaption><\/figure><\/div><\/div><\/div>\s*<p class="ko-findnet">/,
    "the filing card has no Register frame with its captioned logo between its meta line and its read");
  const other = html.match(/<div class="card ko-find"[^>]*>(?:(?!<div class="card ko-find")[\s\S])*?<h3 class="who">TALVERINE<\/h3>[\s\S]*?<p class="ko-findnet">/)?.[0] ?? "";
  assert.ok(other && !other.includes('class="pic-line"'), "a filing card whose logo the run does not hold drew a frame");
  const finding = html.match(/<div class="card ko-find"[^>]*>(?:(?!<div class="card ko-find")[\s\S])*?<h3 class="who">Talvoren Systems<\/h3>[\s\S]*?<p class="ko-findnet">/)?.[0] ?? "";
  assert.ok(finding && !finding.includes('class="pic-line"'), "a finding's card drew a Register frame");
  const none = renderKnockoutHtml(findings, framework, { registerRecords, filingRecords: new Map([[EU, saved]]), logos: new Map([[EU, { state: "failed" }]]) });
  assert.doesNotMatch(none, /class="pic-line"|Logo not retrieved/, "a logo that did not arrive drew a frame or a box");
});

test("the logo step asks about the filings the cards draw, beside the table's rows", () => {
  const mark = findings.marks[0];
  assert.deepEqual(cardFilings(registerRecords, mark, framework).map((r) => r.recordId).sort(),
    [EU, "/mark/gb/00000000-0000-4000-8000-000000000002"], "the cards' filings are not the ones the cards draw");
  const refs = citedRefs({ registerRecords, knockoutMarks: findings.marks, shown: (entry, m) => cardFilings(registerRecords, m, framework) });
  assert.ok(refs.includes(EU.toLowerCase()), "a card's filing is not asked about");
});

test("a name's page reads its own name's web pictures, keyed by the name's place in the run", () => {
  const pics = new Map([["k0-1", ["first name"]], ["k2-1", ["third name, card 1"]], ["k2-4", ["third name, card 4"]], ["k12-1", ["thirteenth name"]]]);
  assert.deepEqual([...picturesForNamePage(pics, 2)], [["k0-1", ["third name, card 1"]], ["k0-4", ["third name, card 4"]]],
    "a name's page took another name's pictures, or lost its own");
  assert.deepEqual([...picturesForNamePage(pics, 1)], [], "a name with no pictures took another's");
  assert.deepEqual([...picturesForNamePage(pics, 0)], [["k0-1", ["first name"]]]);
});
