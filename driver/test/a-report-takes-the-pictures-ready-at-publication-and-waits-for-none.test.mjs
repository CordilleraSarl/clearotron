// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// A REPORT TAKES THE PICTURES READY AT PUBLICATION AND WAITS FOR NONE (2026-11-26). The picture step may run beside
// the report's own work, started from the cards as they stood. At publication the report takes only pictures already
// fetched and shrunk whose page is still on a final card, and goes on at once. A picture that arrives later is
// dropped, a page that left the cards is stale, and a delivered report is never published again to add one. Pages are
// fakes and the names are invented.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pngjs from "pngjs";
import { startPictureStep, freezePictures, webPicturesForReport, PICTURES_FILE, PICTURES_DIR } from "../web-pictures.mjs";

const pngOf = (w, h, shade) => { const p = new pngjs.PNG({ width: w, height: h }); p.data = Buffer.alloc(w * h * 4, shade); return pngjs.PNG.sync.write(p); };
const runFolder = () => { const run = mkdtempSync(join(tmpdir(), "web-picture-freeze-")); mkdirSync(join(run, "_driver")); return run; };
const recordOf = (run) => readFileSync(join(run, "_driver", PICTURES_FILE), "utf8");
const filesOf = (run) => { try { return readdirSync(join(run, "_driver", PICTURES_DIR)).sort(); } catch { return []; } };
const until = async (ok, ms = 10_000) => { const end = Date.now() + ms; while (!ok()) { if (Date.now() > end) throw new Error("timed out waiting"); await new Promise((r) => setTimeout(r, 20)); } };

// A fake web where each page declares `/<name>.png`; a page in `held` answers only when its gate opens, or fails when
// the step is stopped.
const web = (pictures, held = new Map()) => async (url, { signal }) => {
  const u = new URL(url);
  const gate = held.get(u.href);
  if (gate) await new Promise((resolve, reject) => { gate.then(resolve); signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true }); });
  if (u.pathname.endsWith(".png")) return { ok: true, status: 200, url: u.href, contentType: "image/png", bytes: pictures[u.href] };
  return { ok: true, status: 200, url: u.href, contentType: "text/html", bytes: Buffer.from(`<meta property="og:image" content="${u.pathname}.png">`) };
};

test("at publication the report takes the finished pictures of its final cards at once, and none that arrives later", async () => {
  const run = runFolder();
  try {
    let open; const later = new Promise((r) => { open = r; });
    const pictures = { "https://corvanel.example/shop.png": pngOf(40, 30, 200), "https://dravenmoor.example/app.png": pngOf(40, 30, 90) };
    const cards = new Map([[1, ["https://corvanel.example/shop"]], [2, ["https://dravenmoor.example/app"]]]);
    const step = startPictureStep({ cards, seconds: 20, compareFrontPages: false, fetcher: web(pictures, new Map([["https://dravenmoor.example/app", later]])) });
    await until(() => step.rows[0]?.stored);
    const t0 = performance.now();
    const { counts, written } = freezePictures(run, step, cards);
    assert.ok(performance.now() - t0 < 500, `the publication waited ${Math.round(performance.now() - t0)} ms for the step`);
    assert.ok(written);
    assert.deepEqual([counts.eligibleCards, counts.cardsWithPicture, counts.picturesTaken, counts.unfinishedAtPublication, counts.stepEndedBeforePublication],
      [2, 1, 1, 1, false], JSON.stringify(counts));
    assert.deepEqual([...webPicturesForReport(run).keys()], ["1"], "not only the finished picture is drawn");
    const before = recordOf(run), files = filesOf(run);
    open();
    await step.done;
    assert.equal(recordOf(run), before, "a picture arriving after publication changed the record");
    assert.deepEqual(filesOf(run), files, "a picture arriving after publication was saved");
    const again = freezePictures(run, step, cards);
    assert.equal(again.written, false, "a second publication took pictures again");
    assert.equal(recordOf(run), before, "a second publication changed the record");
  } finally { rmSync(run, { recursive: true, force: true }); }
});

test("a page that left the final cards is stale, and a final card's page the step never asked about shows nothing", async () => {
  const run = runFolder();
  try {
    const pictures = { "https://ellisorn.example/old.png": pngOf(40, 30, 60) };
    const step = startPictureStep({ cards: new Map([[4, ["https://ellisorn.example/old"]]]), seconds: 20, compareFrontPages: false, fetcher: web(pictures) });
    await step.done;
    const { counts, record } = freezePictures(run, step, new Map([[5, ["https://fennacre.example/new"]]]));
    assert.deepEqual([counts.stalePictures, counts.finalPagesNeverAsked, counts.cardsWithPicture, counts.stepEndedBeforePublication], [1, 1, 0, true], JSON.stringify(counts));
    assert.equal(webPicturesForReport(run).size, 0, "a stale picture or an unasked page was drawn");
    assert.deepEqual(filesOf(run), [], "a stale picture was saved");
    assert.equal(record.rows.find((r) => r.page === "https://fennacre.example/new")?.addedAfterStart, true);
  } finally { rmSync(run, { recursive: true, force: true }); }
});

test("a step whose pages never answer costs the publication nothing, and a publication with no step records that it ran none", async () => {
  const run = runFolder(), none = runFolder();
  try {
    const never = new Promise(() => {});
    const page = "https://gorsevale.example/listing";
    const step = startPictureStep({ cards: new Map([[1, [page]]]), seconds: 20, compareFrontPages: false, fetcher: web({}, new Map([[page, never]])) });
    const t0 = performance.now();
    const { counts } = freezePictures(run, step, new Map([[1, [page]]]));
    assert.ok(performance.now() - t0 < 500, "the publication waited for a page that never answered");
    assert.equal(counts.cardsWithPicture, 0);
    await step.done;   // stopped by the publication, well inside its own limit
    const { record } = freezePictures(none, null, new Map([[1, [page]]]));
    assert.match(record.notRun ?? "", /did not run in this process/);
    assert.equal(webPicturesForReport(none).size, 0);
  } finally { rmSync(run, { recursive: true, force: true }); rmSync(none, { recursive: true, force: true }); }
});
