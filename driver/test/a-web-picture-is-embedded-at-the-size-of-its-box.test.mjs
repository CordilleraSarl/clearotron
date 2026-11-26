// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// A WEB PICTURE IS EMBEDDED AT THE SIZE OF ITS BOX, AND A SITE'S GENERAL CARD IS NOT SHOWN AS THE NAME IN USE (2026-11-26).
// Embedded as served, the pictures of two measured clearances grew their reports from 316 KB to 3,765 KB and from 267 KB
// to 686 KB. Each picture is now brought down on this machine to its box, in proportion and laid on white, and a picture
// that is not safe or not possible to decode here is not shown. An inner page whose picture is its site front page's is
// dropped; the comparison runs on the same clock as the pages, and an unfinished one leaves the picture out. Pictures are
// made in memory, the pages are fakes, and the names are invented.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import jpeg from "jpeg-js";
import pngjs from "pngjs";
import omggif from "omggif";
import { thumbnailOf, fittedSize, PICTURE_BOX, PICTURE_PIXEL_RATIO, SERVED_WEBP_MAX_BYTES } from "../picture-thumbnail.mjs";
import { fetchPagePictures, writePictureRecord, webPicturesForReport, frontPageOf } from "../web-pictures.mjs";

const MAX_W = PICTURE_BOX.width * PICTURE_PIXEL_RATIO, MAX_H = PICTURE_BOX.height * PICTURE_PIXEL_RATIO;
const pixels = (w, h, { clear = false } = {}) => {
  const d = Buffer.alloc(w * h * 4);
  for (let i = 0; i < w * h; i++) { const x = i % w, y = Math.floor(i / w); d[i * 4] = (x * 255) / w; d[i * 4 + 1] = (y * 255) / h; d[i * 4 + 2] = 90; d[i * 4 + 3] = clear && x < w / 2 ? 0 : 255; }
  return d;
};
const jpegOf = (w, h) => jpeg.encode({ width: w, height: h, data: pixels(w, h) }, 90).data;
const pngOf = (w, h, opts) => { const p = new pngjs.PNG({ width: w, height: h }); p.data = pixels(w, h, opts); return pngjs.PNG.sync.write(p); };

test("a social card is brought down to its box, in proportion, as a JPEG far smaller than served", () => {
  const served = jpegOf(1200, 630);
  const t = thumbnailOf(served);
  assert.equal(t.contentType, "image/jpeg");
  assert.equal(t.kept, "thumbnail");
  assert.deepEqual({ width: t.width, height: t.height }, fittedSize(1200, 630));
  assert.ok(t.width <= MAX_W && t.height <= MAX_H, "the picture is larger than its box needs");
  assert.ok(Math.abs(t.width / t.height - 1200 / 630) < 0.02, "the picture lost its proportion");
  assert.ok(t.bytes.length * 4 < served.length, `the picture is ${t.bytes.length} bytes of ${served.length} served`);
  const back = jpeg.decode(t.bytes);
  assert.deepEqual([back.width, back.height], [t.width, t.height]);
});

test("a transparent PNG is laid on the white its box shows, and a GIF gives its first frame", () => {
  const t = thumbnailOf(pngOf(600, 300, { clear: true }));
  assert.equal(t.contentType, "image/jpeg");
  const back = jpeg.decode(t.bytes);
  assert.ok([...back.data.subarray(0, 3)].every((c) => c >= 250), `the clear half is not white: ${[...back.data.subarray(0, 3)]}`);
  const gif = Buffer.alloc(4096), w = new omggif.GifWriter(gif, 400, 200, { palette: [0xffffff, 0x1f3a93] });
  w.addFrame(0, 0, 400, 200, Array.from({ length: 400 * 200 }, (_, i) => (i % 400 < 200 ? 1 : 0)));
  const g = thumbnailOf(gif.subarray(0, w.end()));
  assert.equal(g.contentType, "image/jpeg", g.refused);
  assert.deepEqual({ width: g.width, height: g.height }, fittedSize(400, 200));
});

test("a picture is not decoded when its header declares more pixels than the limit, and a large WebP is not shown", () => {
  const bomb = pngOf(8, 8);
  bomb.writeUInt32BE(30000, 16); bomb.writeUInt32BE(30000, 20);
  assert.match(thumbnailOf(bomb).refused ?? "", /million pixels/, "a picture declaring 900 million pixels was decoded");
  const webp = (n) => Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBP"), Buffer.alloc(n)]);
  assert.equal(thumbnailOf(webp(1000)).kept, "as served", "a small WebP was not kept as served");
  assert.match(thumbnailOf(webp(SERVED_WEBP_MAX_BYTES + 1)).refused ?? "", /WebP/, "a large WebP was embedded as served");
  assert.ok(thumbnailOf(Buffer.from("not a picture")).refused);
});

test("a picture already as small as its box is kept as served when re-writing it would not make it smaller", () => {
  const small = pngOf(40, 30);
  const t = thumbnailOf(small);
  assert.ok(t.kept === "as served" ? t.bytes === small : t.bytes.length < small.length, "a small picture was re-written larger");
});

// A fake web: each page declares `/<name>.png` as its preview, and the pictures are bytes chosen per test.
const fakeWeb = (pictures, { hang = new Set() } = {}) => async (url, { signal }) => {
  const u = new URL(url);
  if (hang.has(u.href)) return new Promise((_, reject) => signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true }));
  if (u.pathname.endsWith(".png")) return { ok: true, status: 200, url: u.href, contentType: "image/png", bytes: pictures[u.href] };
  const name = u.pathname === "/" ? "front" : u.pathname.slice(1);
  return { ok: true, status: 200, url: u.href, contentType: "text/html", bytes: Buffer.from(`<meta property="og:image" content="/${name}.png">`) };
};

test("each picture is shrunk as it arrives; the record keeps what the site served and stores the shrunk picture, which still draws", async () => {
  const run = mkdtempSync(join(tmpdir(), "web-picture-thumb-"));
  try {
    mkdirSync(join(run, "_driver"));
    const served = pngOf(1200, 630);
    const sha = createHash("sha256").update(served).digest("hex");
    const result = await fetchPagePictures(["https://ostrevin.example/shop"], { seconds: 20, fetcher: fakeWeb({ "https://ostrevin.example/shop.png": served }), compareFrontPages: false });
    assert.ok(Number.isFinite(result.shrinkMs), "the time shrinking took is not kept");
    const rec = writePictureRecord(run, { cards: new Map([[1, ["https://ostrevin.example/shop"]]]), result, seconds: 20, concurrency: 6, takenAt: "2026-11-26T10:00:00.000Z" });
    const row = rec.rows[0];
    assert.deepEqual([row.contentType, row.bytes, row.sha256, row.width, row.height], ["image/png", served.length, sha, 1200, 630], "what the site served is not kept as evidence");
    assert.ok(Number.isFinite(row.shrinkMs), "a picture's own shrinking time is not kept");
    assert.equal(row.stored.contentType, "image/jpeg");
    assert.equal(readFileSync(join(run, row.file)).length, row.stored.bytes);
    assert.equal(rec.shrinkMs, result.shrinkMs);
    const drawn = webPicturesForReport(run).get("1") ?? [];
    assert.equal(drawn.length, 1, "a PNG stored as a JPEG was not drawn");
    assert.match(drawn[0].src, /^data:image\/jpeg;base64,/);
  } finally { rmSync(run, { recursive: true, force: true }); }
});

test("a picture still being shrunk at the limit is recorded as not shrunk in time, keeps no bytes and is not drawn", async () => {
  // A pool whose worker never answers: only the limit ends its work.
  const stuck = () => { const held = []; return { shrink: () => new Promise((resolve) => held.push(resolve)), close: () => held.forEach((r) => r({ unfinished: true })) }; };
  const result = await fetchPagePictures(["https://pellavine.example/app"], { seconds: 0.3, compareFrontPages: false, makeShrinker: stuck,
    fetcher: fakeWeb({ "https://pellavine.example/app.png": pngOf(30, 20) }) });
  const [row] = result.rows;
  assert.ok(result.aborted, "the step did not end at its limit");
  assert.equal(row.state, "fetched");
  assert.equal(row.notStored, "not shrunk within the limit");
  assert.equal(row.data, null, "a picture not shrunk in time kept its bytes");
  const run = mkdtempSync(join(tmpdir(), "web-picture-late-"));
  try {
    mkdirSync(join(run, "_driver"));
    writePictureRecord(run, { cards: new Map([[1, ["https://pellavine.example/app"]]]), result, seconds: 0.3, concurrency: 6 });
    assert.equal(webPicturesForReport(run).size, 0, "a picture not shrunk in time was drawn");
  } finally { rmSync(run, { recursive: true, force: true }); }
});

test("an inner page whose picture is its site front page's is dropped; the front page is asked on the same clock and gives no card a picture", async () => {
  const general = pngOf(20, 10), own = pngOf(10, 20);
  const pictures = { "https://varnolde.example/front.png": general, "https://varnolde.example/shop.png": general, "https://varnolde.example/app.png": own };
  const { rows } = await fetchPagePictures(["https://varnolde.example/shop", "https://varnolde.example/app"], { seconds: 5, fetcher: fakeWeb(pictures) });
  assert.deepEqual(rows.map((r) => r.page), ["https://varnolde.example/shop", "https://varnolde.example/", "https://varnolde.example/app"],
    "the front page is not asked once, right after the first of its site's pages");
  const [shop, front, app] = rows;
  assert.equal(shop.general, true, "the site's general card was kept as the name in use");
  assert.ok(!app.general && !app.comparison, "a page with its own picture was dropped");
  assert.equal(front.forComparison, true);
  assert.equal(front.data, null, "a front page fetched only to compare kept its picture");
  const run = mkdtempSync(join(tmpdir(), "web-picture-front-"));
  try {
    mkdirSync(join(run, "_driver"));
    writePictureRecord(run, { cards: new Map([[1, ["https://varnolde.example/shop", "https://varnolde.example/app"]]]), result: { ms: 1, aborted: false, rows }, seconds: 5, concurrency: 6 });
    assert.deepEqual((webPicturesForReport(run).get("1") ?? []).map((p) => p.page), ["https://varnolde.example/app"], "not only the page's own picture is drawn");
  } finally { rmSync(run, { recursive: true, force: true }); }
});

test("a cited front page keeps its picture as use evidence, and a comparison unfinished at the limit leaves the picture out", async () => {
  const card = pngOf(20, 10);
  const pictures = { "https://quorvel.example/front.png": card, "https://quorvel.example/news.png": card };
  const { rows } = await fetchPagePictures(["https://quorvel.example/", "https://quorvel.example/news"], { seconds: 5, fetcher: fakeWeb(pictures) });
  assert.equal(rows.length, 2, "a front page a card cites was asked twice");
  assert.ok(rows[0].state === "fetched" && !rows[0].general, "the cited front page lost its picture");
  assert.equal(rows[1].general, true);
  const slow = await fetchPagePictures(["https://brendalor.example/shop"],
    { seconds: 0.3, fetcher: fakeWeb({ "https://brendalor.example/shop.png": card }, { hang: new Set([frontPageOf("https://brendalor.example/shop")]) }) });
  assert.equal(slow.rows[0].state, "fetched");
  assert.equal(slow.rows[0].comparison, "unfinished", "a picture whose comparison had not finished at the limit was kept");
});

test("on a Knockout, a picture repeated on different pages of one site is its generic preview, except on a cited front page; one page cited twice is not", async () => {
  const generic = pngOf(20, 10), own = pngOf(10, 20), other = pngOf(16, 16);
  const pictures = { "https://harrowmere.example/a.png": generic, "https://harrowmere.example/b.png": generic, "https://harrowmere.example/front.png": generic,
    "https://harrowmere.example/c.png": own, "https://istravel.example/a.png": generic, "https://jorvane.example/x.png": other, "https://jorvane.example/y.png": other };
  const pages = ["https://harrowmere.example/a", "https://harrowmere.example/b", "https://harrowmere.example/", "https://harrowmere.example/c",
    "https://istravel.example/a", "https://jorvane.example/x", "https://jorvane.example/y", "https://harrowmere.example/c"];
  const { rows } = await fetchPagePictures(pages, { seconds: 5, fetcher: fakeWeb(pictures), compareFrontPages: false, repeatedOnSite: true, shrink: false });
  const dropped = Object.fromEntries(rows.map((r) => [r.page, Boolean(r.general)]));
  assert.equal(rows.length, 7, "a page cited twice was fetched twice, or a front page was fetched to compare");
  assert.deepEqual(dropped, {
    "https://harrowmere.example/a": true, "https://harrowmere.example/b": true, "https://harrowmere.example/": false, "https://harrowmere.example/c": false,
    "https://istravel.example/a": false, "https://jorvane.example/x": true, "https://jorvane.example/y": true,
  }, "the generic preview rule dropped the wrong pages");
});
