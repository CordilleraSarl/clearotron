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
    { seconds: 10, fetcher: local });
  assert.deepEqual(rows.map((r) => r.state), ["fetched", "fetched", "none", "not-a-picture", "refused", "fetched"]);
  assert.equal(rows[0].picture, `${base}/pic.png`);
  assert.equal(rows[0].contentType, "image/png");
  assert.ok(rows[0].data.equals(PNG) && rows[0].sha256 && rows[0].ms !== null, "the picture's bytes, hash or arrival time are missing");
  assert.equal(rows[1].picture, `${base}/direct.png`, "an address that answers with an image is not its own picture");
});

test("at the limit an open request is abandoned and an unrequested page is not tried; nothing later is kept", async () => {
  const pages = Array.from({ length: 4 }, (_, i) => `${base}/slow${i}`);
  const { rows, aborted } = await fetchPagePictures(pages, { seconds: 0.4, concurrency: 2, fetcher: local });
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
