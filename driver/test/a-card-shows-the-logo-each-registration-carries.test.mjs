// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A CARD SHOWS THE LOGO EACH CITED REGISTRATION CARRIES, ON A LINE OF ITS OWN (owner, 2026-11-18).
//
// A lawyer compares logos first, and the report showed none. The run's logo step saves each cited registration's
// logo; the report embeds it, so the delivered page fetches nothing and never names the register's image address.
// On a card the logos sit under the owner line, one fixed box each, captioned with the register. A logo the step
// tried and failed to fetch draws nothing (owner, 2026-11-25), as a registration with no logo does, and so does a
// run that fetched none. A grouped negative row shows up to three small logos and "+N", counting only the logos it
// can draw.
// The reader admits only an image saved inside the run's logo folder that opens as the type it was saved as.
// Every name, number and image here is invented.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseReport } from "../publish/parse.mjs";
import { renderHtml } from "../publish/render.mjs";
import { logosForReport } from "../mark-logos.mjs";

// The smallest PNG: its signature, then one transparent pixel.
const PNG = Buffer.from("89504e470d0a1a0a0000000d4948445200000001000000010806000000" +
  "1f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082", "hex");
const DATA = `data:image/png;base64,${PNG.toString("base64")}`;

// The failure stays in the reader's map, which the report document records; the page draws nothing for it.
test("the reader embeds a saved image, keeps a failure, and admits nothing else", () => {
  const run = mkdtempSync(join(tmpdir(), "logos-"));
  try {
    mkdirSync(join(run, "_driver", "logos"), { recursive: true });
    writeFileSync(join(run, "_driver", "logos", "em-1.png"), PNG);
    writeFileSync(join(run, "_driver", "logos", "em-6.png"), Buffer.from("not an image"));
    writeFileSync(join(run, "outside.png"), PNG);
    writeFileSync(join(run, "_driver", "logos.json"), JSON.stringify({ schema: 1, register: "clarivate", rows: [
      { ref: "/mark/em/1", state: "fetched", file: "_driver/logos/em-1.png", contentType: "image/png", bytes: PNG.length },
      { ref: "/mark/em/2", state: "failed", cause: "HTTP 503" },
      { ref: "/mark/em/3", state: "no-logo" },
      { ref: "/mark/em/4", state: "unknown", cause: "this run makes no register call" },
      { ref: "/mark/em/5", state: "fetched", file: "outside.png", contentType: "image/png" },
      { ref: "/mark/em/6", state: "fetched", file: "_driver/logos/em-6.png", contentType: "image/png" },
      { ref: "/mark/em/7", state: "fetched", file: "_driver/logos/em-1.png", contentType: "image/svg+xml" },
    ] }));
    const logos = logosForReport(run);
    assert.deepEqual([...logos.keys()], ["/mark/em/1", "/mark/em/2"], "only the saved image and the failure are shown");
    assert.deepEqual(logos.get("/mark/em/1"), { state: "fetched", src: DATA });
    assert.deepEqual(logos.get("/mark/em/2"), { state: "failed" });
    assert.equal(logosForReport(mkdtempSync(join(tmpdir(), "logos-none-"))).size, 0, "a run with no logo file has no logos");
  } finally { rmSync(run, { recursive: true, force: true }); }
});

const REPORT = (() => {
  const dir = mkdtempSync(join(tmpdir(), "clearotron-logos-"));
  try {
    writeFileSync(join(dir, "r.report.md"), ["---", "type: clearance-clearance", "matter: logo-test", "title: OSTREVIN",
      "overall_label: MEDIUM", "overall_badge: l3", "classes: 9", "jurisdiction: European Union", "run: 2026-11-19", "---", ""].join("\n"));
    return parseReport(join(dir, "r.report.md"));
  } finally { rmSync(dir, { recursive: true, force: true }); }
})();
const record = (uri, office, mark = "SKARVEL") => ({
  uri, provider: "clarivate", office, applicationNumber: uri.split("/").at(-1), registrationNumber: uri.split("/").at(-1),
  statusText: "REGISTERED", markText: mark, markFeature: "WORD AND DESIGN", imageAvailable: true,
  owner: "Brisavel Acoustics, S.L.", ownerCountry: "ES", goodsServices: [{ classes: ["9"], language: "en", description: "Headphones." }],
});
const EU = "/mark/em/018046213", GB = "/mark/gb/uk00003412876", DE = "/mark/de/302020118845";
const RECORDS = [record(EU, "em"), record(GB, "gb"), record(DE, "de")];
const LINKS = new Map([[DE, { office: "de", label: "DE 302020118845", href: "https://register.example/de/302020118845", reason: null }]]);
const card = (registrations, opts = {}) => renderHtml(REPORT, [{
  ordinal: 3, mark: "SKARVEL", composite: 4, disposition: "adversarial", net: "Brisavel would probably win.",
  owner: { name: "Brisavel Acoustics, S.L.", registrations },
}], [], { runId: "logo-test", recordsByUri: new Map(RECORDS.map((r) => [r.uri, r])), recordLinks: LINKS, ...opts });

test("a card's logos sit on their own line under the owner, captioned with their register", () => {
  const logos = new Map([[EU, { state: "fetched", src: DATA }], [GB, { state: "fetched", src: DATA }], [DE, { state: "failed" }]]);
  const html = card([{ uri: EU, jurisdiction: "EM" }, { uri: GB, jurisdiction: "GB" }, { uri: DE, jurisdiction: "DE" }], { logos });
  const line = html.match(/<div class="owner-line">(?:(?!<div class="oneline">)[\s\S])*?<\/div><div class="pic-line"><div class="pic-set"><div class="pic-head"><span class="pic-lab">Register<\/span><\/div>(<div class="rr-logos rr-band">[\s\S]*?<\/div>)<\/div><\/div>\s*<div class="oneline">/)?.[1];
  assert.ok(line, "the logo line is not between the owner line and the card's sentence, in a frame labelled Register (owner, 2026-11-25)");
  assert.ok(line.includes(`<img src="${DATA}" alt="SKARVEL, logo as registered in European Union">`), "the EU logo, embedded, with its screen-reader text");
  assert.deepEqual([...line.matchAll(/<figcaption>([^<]+)<\/figcaption>/g)].map((m) => m[1]), ["EU", "UK"], "the captions, in the card's order, each register as a reader names it, and none for the failed fetch");
  assert.doesNotMatch(html, /Logo not retrieved|rr-nologo|register\.example\/de\/302020118845" target="_blank" rel="noopener noreferrer"><\/a>/, "a failed fetch drew a box in its place");
  assert.doesNotMatch(html, /https?:\/\/[^"]*\.(png|jpe?g|gif|webp)"/i, "the page points at an image address");
});

test("a registration without a logo draws nothing, and a run that fetched none draws no line", () => {
  const some = card([{ uri: EU, jurisdiction: "EM" }, { uri: GB, jurisdiction: "GB" }], { logos: new Map([[GB, { state: "fetched", src: DATA }]]) });
  assert.equal((some.match(/<figure class="rr-lg">/g) ?? []).length, 1, "a registration with no saved logo drew a box");
  const none = card([{ uri: EU, jurisdiction: "EM" }]);
  assert.doesNotMatch(none, /<div class="rr-logos|class="pic-line"/, "a run that fetched no logos drew a logo line or an empty frame");
  const failed = card([{ uri: DE, jurisdiction: "DE" }], { logos: new Map([[DE, { state: "failed" }]]) });
  assert.doesNotMatch(failed, /<div class="rr-logos|<figure class="rr-lg">|class="pic-line"/, "a card whose only logo failed to fetch drew a logo line or an empty frame");
});

test("a grouped negative row shows up to three small logos and +N under its text", () => {
  const uris = Array.from({ length: 5 }, (_, i) => `/mark/em/01804621${i}`);
  const recs = uris.map((u) => record(u, "em", "SKARVELIS"));
  const html = renderHtml(REPORT, [{
    ordinal: 9, mark: "SKARVELIS", band: "Manageable", disposition: "distinguished", net: "Ostrevin would very likely defeat this claim.",
    legal_position: "Different goods.", practical_position: "No enforcement on record.",
    owner: { name: "Varrow Holdings Ltd", registrations: uris.map((uri) => ({ uri, jurisdiction: "EM" })) },
  }], [], { runId: "logo-test", findingsSchemaVersion: 6, recordsByUri: new Map(recs.map((r) => [r.uri, r])),
    logos: new Map(uris.map((u) => [u, { state: "fetched", src: DATA }])) });
  const row = html.match(/<details class="rgroup rn"(?: id="c\d+")?><summary>([\s\S]*?)<\/summary>/)?.[1] ?? "";
  assert.ok(row, "the negative row is not drawn");
  const small = row.match(/<div class="rr-logos rr-sm">([\s\S]*?)<\/div>$/)?.[1] ?? "";
  assert.equal((small.match(/<figure class="rr-lg">/g) ?? []).length, 3, "the row does not show three small logos");
  assert.ok(small.endsWith('<span class="rr-more">+2</span>'), "the row does not count the rest");
  assert.doesNotMatch(small, /figcaption/, "a small logo carries a caption");
  // A failed fetch is neither drawn nor counted in the "+N".
  const withFailure = renderHtml(REPORT, [{
    ordinal: 9, mark: "SKARVELIS", band: "Manageable", disposition: "distinguished", net: "Ostrevin would very likely defeat this claim.",
    legal_position: "Different goods.", practical_position: "No enforcement on record.",
    owner: { name: "Varrow Holdings Ltd", registrations: uris.map((uri) => ({ uri, jurisdiction: "EM" })) },
  }], [], { runId: "logo-test", findingsSchemaVersion: 6, recordsByUri: new Map(recs.map((r) => [r.uri, r])),
    logos: new Map(uris.map((u, i) => [u, i === 1 ? { state: "failed" } : { state: "fetched", src: DATA }])) });
  const smallAfter = withFailure.match(/<details class="rgroup rn"(?: id="c\d+")?><summary>[\s\S]*?<div class="rr-logos rr-sm">([\s\S]*?)<\/div><\/summary>/)?.[1] ?? "";
  assert.equal((smallAfter.match(/<figure class="rr-lg">/g) ?? []).length, 3, "the row does not show three small logos when one fetch failed");
  assert.ok(smallAfter.endsWith('<span class="rr-more">+1</span>'), "the row counts a failed fetch among the rest");
  assert.doesNotMatch(withFailure, /Logo not retrieved|rr-nologo/, "a failed fetch drew a box on the row");
});
