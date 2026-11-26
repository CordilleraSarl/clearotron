// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// THE PICTURE A WEB PAGE DECLARES FOR ITSELF, AND NOTHING ELSE (owner, 2026-11-25 and 2026-11-26). A report takes a picture
// only from a page where a card says the name is in use, only the one picture the page declares as its preview, only
// inside one limit for the whole report, and never from an office's or a register's own record. Invented names, and
// pages served on this machine.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { clearancePages, previewPictureOf, fetchPagePictures, fetchBytes, onRegisterRecordHost, citedAddresses, REGISTER_RECORD_HOSTS,
  CLEARANCE_PICTURE_SECONDS, KNOCKOUT_PICTURE_SECONDS } from "../web-pictures.mjs";

test("a card collects the pages where it says the name is in use, and never a register's record", () => {
  const pages = clearancePages([
    { ordinal: 1, disposition: "adversarial", source: { source_type: "common-law-marketplace", resolved_link: "https://shop.example/brisandor#reviews" },
      meters: { use: { token: "not-confirmed" } }, use_check: { source: "https://brisandor.example/about, https://www.trademarkia.com/brisandor-1" } },
    { ordinal: 2, disposition: "adversarial", source: { source_type: "register-vendor" }, meters: { use: { token: "confirmed" } },
      use_check: { source: "https://quellmont.example/products" } },
    { ordinal: 3, disposition: "adversarial", source: { source_type: "register-vendor" }, meters: { use: { token: "not-confirmed" } },
      use_check: { source: "https://looked.example/nothing" } },
    { ordinal: 4, disposition: "adversarial", source: { source_type: "register-vendor" }, meters: { use: { token: "confirmed" } },
      use_check: { source: "https://mirror.example/listing", quality: "register-mirror" } },
    { ordinal: 5, disposition: "off-field", source: { source_type: "register-vendor" }, meters: { use: { token: "confirmed" } },
      use_check: { source: "https://offfield.example/" } },
    { ordinal: 6, disposition: "withdrawn", source: { source_type: "common-law-web", resolved_link: "https://gone.example/" } },
    { ordinal: 7, disposition: "distinguished", source: { source_type: "common-law-web", resolved_link: "https://secondary.example/page" } },
  ]);
  assert.deepEqual([...pages.entries()], [
    [1, ["https://brisandor.example/about", "https://shop.example/brisandor"]],
    [2, ["https://quellmont.example/products"]],
    [7, ["https://secondary.example/page"]],
  ], "a page was collected that the card does not say the name is used on, or a card lost one");
  assert.equal(REGISTER_RECORD_HOSTS.length, 20);
  for (const u of ["https://www.trademarkia.com/x", "https://euipo.europa.eu/eSearch/", "https://tsdr.uspto.gov/x", "https://branddb.wipo.int/x"]) {
    assert.ok(onRegisterRecordHost(u), `${u} is a register's record and was not recognised`);
  }
  assert.ok(!onRegisterRecordHost("https://notwipo.int.example/"), "a host that merely contains a register's name was refused");
  assert.deepEqual(citedAddresses("see https://a.example/x). and https://a.example/x#y"), ["https://a.example/x"]);
});

test("a page's preview picture is its first og:image, else its twitter:image, read against its address", () => {
  assert.equal(previewPictureOf('<meta content="/i/card.png" property="og:image"><meta property="og:image" content="/second.png">', "https://brisandor.example/app/1"),
    "https://brisandor.example/i/card.png");
  assert.equal(previewPictureOf("<meta name='twitter:image' content='https://cdn.example/t.jpg?a=1&amp;b=2'>", "https://x.example/"), "https://cdn.example/t.jpg?a=1&b=2");
  assert.equal(previewPictureOf('<meta property="og:title" content="Brisandor">', "https://x.example/"), null);
  assert.equal(previewPictureOf('<meta property="og:image" content="data:image/png;base64,AAAA">', "https://x.example/"), null, "a data address was taken");
});

const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082", "hex");
const server = http.createServer((req, res) => {
  const u = req.url;
  if (u === "/page") { res.setHeader("content-type", "text/html"); return res.end('<html><head><meta property="og:image" content="/pic.png"></head></html>'); }
  if (u === "/pic.png" || u === "/direct.png") { res.setHeader("content-type", "image/png"); return res.end(PNG); }
  if (u === "/bare") { res.setHeader("content-type", "text/html"); return res.end("<html><head><title>no picture</title></head></html>"); }
  if (u === "/svgpage") { res.setHeader("content-type", "text/html"); return res.end('<meta property="og:image" content="/p.svg">'); }
  if (u === "/p.svg") { res.setHeader("content-type", "image/svg+xml"); return res.end("<svg xmlns='http://www.w3.org/2000/svg'/>"); }
  if (u.startsWith("/slow")) { setTimeout(() => { res.setHeader("content-type", "image/png"); res.end(PNG); }, 1500); return; }
  if (u === "/moved") { res.statusCode = 302; res.setHeader("location", "/page"); return res.end(); }
  res.statusCode = 404; res.end("no");
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
after(() => server.close());
const base = `http://127.0.0.1:${server.address().port}`;
// The test opens the address check for this machine only; the product's check refuses it (the last arm).
const local = (u, o) => fetchBytes(u, { ...o, allow: () => ({ ok: true }) });

test("each page gives its declared picture or a recorded reason, and only the four image types count", async () => {
  const { rows } = await fetchPagePictures([`${base}/page`, `${base}/direct.png`, `${base}/bare`, `${base}/svgpage`, `${base}/missing`, `${base}/moved`],
    { seconds: 10, fetcher: local, compareFrontPages: false, shrink: false });   // the general-card rule and shrinking have their own test
  assert.deepEqual(rows.map((r) => r.state), ["fetched", "fetched", "none", "not-a-picture", "refused", "fetched"]);
  assert.equal(rows[0].picture, `${base}/pic.png`);
  assert.equal(rows[0].contentType, "image/png");
  assert.ok(rows[0].data.equals(PNG) && rows[0].sha256 && rows[0].ms !== null, "the picture's bytes, hash or arrival time are missing");
  assert.equal(rows[1].picture, `${base}/direct.png`, "an address that answers with an image is not its own picture");
});

test("at the limit an open request is abandoned and an unrequested page is not tried; nothing later is kept", async () => {
  const pages = Array.from({ length: 4 }, (_, i) => `${base}/slow${i}`);
  const { rows, aborted } = await fetchPagePictures(pages, { seconds: 0.4, concurrency: 2, fetcher: local, compareFrontPages: false, shrink: false });
  assert.ok(aborted);
  assert.deepEqual(rows.map((r) => r.state), ["not-arrived", "not-arrived", "not-tried", "not-tried"]);
  assert.ok(rows.every((r) => r.data === null), "a picture arriving after the limit was kept");
  assert.equal(CLEARANCE_PICTURE_SECONDS, 20);
  assert.equal(KNOCKOUT_PICTURE_SECONDS, 20);
});

test("the address check refuses this machine, so a page cannot point the fetch inward", async () => {
  assert.ok((await fetchBytes(`${base}/page`)).refused, "a loopback address was fetched");
  const { rows } = await fetchPagePictures([`${base}/page`], { seconds: 5 });
  assert.equal(rows[0].state, "refused");
});

// ── THE RECORD AND THE FRAME ─────────────────────────────────────────────────────────────────────────────────────────
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writePictureRecord, webPicturesForReport } from "../web-pictures.mjs";
import { parseReport } from "../publish/parse.mjs";
import { renderHtml } from "../publish/render.mjs";

test("the record keeps every page's outcome, and a card draws its own pages' pictures in its order, each once, never a general card", () => {
  const run = mkdtempSync(join(tmpdir(), "web-pictures-run-"));
  try {
    mkdirSync(join(run, "_driver"));
    const other = Buffer.concat([PNG, Buffer.from([0])]);
    const row = (page, data, extra = {}) => ({ page, site: new URL(page).hostname, state: data ? "fetched" : "none", picture: data ? `${page}.png` : null,
      contentType: data ? "image/png" : null, bytes: data ? data.length : 0, sha256: data ? (data === PNG ? "a".repeat(64) : "b".repeat(64)) : null, ms: 10, data, ...extra });
    const result = { ms: 40, aborted: false, rows: [row("https://one.example/a", PNG), row("https://two.example/b", PNG), row("https://three.example/c", other), row("https://four.example/d", null)] };
    const cards = new Map([[3, ["https://three.example/c", "https://one.example/a", "https://two.example/b"]], [5, ["https://four.example/d"]]]);
    const rec = writePictureRecord(run, { cards, result, seconds: 20, concurrency: 6, takenAt: "2026-11-26T10:00:00.000Z" });
    assert.deepEqual(rec.rows.map((r) => r.state), ["fetched", "fetched", "fetched", "none"], "a page's outcome was lost");
    assert.ok(rec.rows.every((r) => !("data" in r)), "the record carries picture bytes");
    let drawn = webPicturesForReport(run);
    assert.deepEqual([...drawn.keys()], ["3"], "a card with no picture is drawn, or one with pictures is not");
    assert.deepEqual(drawn.get("3").map((p) => p.site), ["three.example", "one.example"], "not the card's order, or a picture two pages share showed twice");
    assert.match(drawn.get("3")[0].src, /^data:image\/png;base64,/);
    assert.equal(drawn.get("3")[0].fetchedOn, "2026-11-26");
    writePictureRecord(run, { cards, result, seconds: 20, concurrency: 6, general: new Set(["b".repeat(64)]) });
    drawn = webPicturesForReport(run);
    assert.deepEqual(drawn.get("3").map((p) => p.site), ["one.example"], "a site's general card was drawn");
    writeFileSync(join(run, "_driver", "web-pictures.json"), JSON.stringify({ takenAt: "x", cards: { 1: ["https://e.example/"] },
      rows: [{ page: "https://e.example/", state: "fetched", contentType: "image/png", sha256: "c", file: "../outside.png" }] }));
    assert.equal(webPicturesForReport(run).size, 0, "a file outside the run's picture folder was drawn");
  } finally { rmSync(run, { recursive: true, force: true }); }
});

test("a card draws On the web after Register, captioned with the site and opening the page; without pictures, nothing", () => {
  const dir = mkdtempSync(join(tmpdir(), "web-pictures-page-"));
  try {
    writeFileSync(join(dir, "r.report.md"), ["---", "type: clearance-clearance", "matter: pictures", "title: OSTREVIN", "run: 2026-11-26", "---", ""].join("\n"));
    const parsed = parseReport(join(dir, "r.report.md"));
    const f = { ordinal: 4, mark: "SKARVEL", composite: 4, net: "A sentence.", owner: { name: "Brannock Tools Ltd", registrations: [] }, source: { source_type: "common-law-web" } };
    const src = `data:image/png;base64,${PNG.toString("base64")}`;
    const html = renderHtml(parsed, [f], [], { runId: "pictures", webPictures: new Map([["4", [{ page: "https://shop.example/skarvel", site: "shop.example", src, fetchedOn: "2026-11-26" }]]]) });
    const line = html.match(/<div class="pic-line">([\s\S]*?)<\/div><\/div><\/div>/)?.[1] ?? "";
    assert.match(line, /<span class="pic-lab">On the web<\/span>/, "the frame is missing or mislabelled");
    assert.match(line, /<a href="https:\/\/shop\.example\/skarvel" target="_blank" rel="noopener noreferrer"><img src="data:image\/png;base64,[^"]+" alt="SKARVEL, picture shown by shop\.example, fetched 2026-11-26"><\/a><figcaption>shop\.example<\/figcaption>/,
      "the picture does not open its page, carry its alt text, or caption its site");
    const none = renderHtml(parsed, [f], [], { runId: "pictures" });
    assert.doesNotMatch(none, /class="pic-line"|pic-lab">On the web/, "a card with no pictures drew a frame");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a request that does not answer within its own limit fails, so no page holds the step open without the report's limit", async () => {
  const slow = (u, o) => fetchBytes(u, { ...o, timeoutMs: 300, allow: () => ({ ok: true }) });
  const { rows } = await fetchPagePictures([`${base}/slow-one`], { seconds: Infinity, fetcher: slow });
  assert.equal(rows[0].state, "failed", "a request past its own limit was not given up");
});

import { knockoutPages } from "../web-pictures.mjs";
import { renderKnockoutHtml } from "../publish/render-knockout.mjs";
import { parseFrameworkManifest } from "../framework.mjs";
import { readFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

test("a Knockout finding card collects its Sources addresses in order, and draws the earliest one's picture alone", () => {
  const RUN = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "report-pages", "knockout-with-findings", "run");
  const doc = JSON.parse(readFileSync(join(RUN, "knockout-findings.json"), "utf8"));
  const pages = knockoutPages({ marks: [{ findings: [{ ordinal: 1, evidence: ["https://a.example/x#top", "/mark/eu/1", "https://euipo.europa.eu/eSearch/1", "https://b.example/y"] }, { ordinal: 2, evidence: ["/mark/gb/2"] }] }] });
  assert.deepEqual([...pages.entries()], [["k0-1", ["https://a.example/x", "https://b.example/y"]]], "a filing, a register record or a fragment was collected, or the order changed");
  const src = `data:image/png;base64,${PNG.toString("base64")}`;
  const pics = new Map([["k0-1", [{ page: "https://talvoren.example.test/products", site: "talvoren.example.test", src, fetchedOn: "2026-11-26" },
    { page: "https://second.example.test/", site: "second.example.test", src, fetchedOn: "2026-11-26" }]]]);
  const html = renderKnockoutHtml(doc, parseFrameworkManifest(JSON.parse(readFileSync(join(RUN, "_driver", "framework.json"), "utf8"))),
    { registerRecords: JSON.parse(readFileSync(join(RUN, "_driver", "register-records.json"), "utf8")), webPictures: pics });
  const card = html.match(/<div class="card ko-find" id="k0-1"[\s\S]*?<p class="ko-findnet">/)?.[0] ?? "";
  assert.match(card, /<p class="ko-findmeta">[^<]*<\/p>\s*<div class="pic-line"><div class="pic-set"><div class="pic-head"><span class="pic-lab">On the web<\/span><\/div><div class="rr-logos rr-band"><figure class="rr-lg"><a href="https:\/\/talvoren\.example\.test\/products" target="_blank" rel="noopener noreferrer"><img src="data:image\/png;base64,[^"]+" alt="Talvoren Systems, picture shown by talvoren\.example\.test, fetched 2026-11-26"><\/a><figcaption>talvoren\.example\.test<\/figcaption><\/figure><\/div><\/div><\/div>/,
    "the finding card has no On the web frame with its earliest picture under its meta line");
  assert.equal((card.match(/<figure class="rr-lg">/g) ?? []).length, 1, "a Knockout finding card shows more than one web picture");
});
