// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// THE WEB PICTURE STEP ASKS ONLY THE FETCHER IT IS HANDED (2026-11-26). A clearance starts its picture step beside the
// writer and takes, at publication, what is ready. On the mock engine it asks no live page: the harness hands it a
// fetcher that records each address and answers with no picture. A test of a picture serves a local one through the
// same interface, and the published page draws exactly the cards the record counts. Invented addresses only.
// @tier full
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import pngjs from "pngjs";
import { runPipeline, findFile } from "./pipeline-mock-harness.mjs";

const frames = (html) => (html.match(/class="pic-lab">On the web</g) ?? []).length;
const counts = (events) => events.find((e) => e.event === "web-pictures") ?? null;

test("on the mock engine the step asks only the recording fetcher, and the report shows no web picture", async () => {
  const { root, events, pictureRequests } = await runPipeline({});
  const row = counts(events);
  assert.ok(row, "the publication logged no web-pictures row");
  assert.ok(Array.isArray(pictureRequests), "the run was not handed the recording fetcher");
  assert.equal(row.cardsWithPicture, 0);
  assert.equal(frames(readFileSync(findFile(root, "report.html"), "utf8")), 0, "a picture was drawn from a page that declared none");
});

test("a local picture served through the same interface is drawn on exactly the cards the record counts", async (t) => {
  const picture = (() => { const p = new pngjs.PNG({ width: 60, height: 40 }); p.data = Buffer.alloc(60 * 40 * 4, 150); return pngjs.PNG.sync.write(p); })();
  const asked = [];
  const local = async (url) => {
    asked.push(String(url));
    const u = new URL(String(url));
    if (u.pathname.endsWith("/preview.png")) return { ok: true, status: 200, url: u.href, contentType: "image/png", bytes: picture };
    // The site's front page declares no picture, so the page's own is not its general card.
    if (u.pathname === "/") return { ok: true, status: 200, url: u.href, contentType: "text/html", bytes: Buffer.from("<title>front</title>") };
    return { ok: true, status: 200, url: u.href, contentType: "text/html", bytes: Buffer.from('<meta property="og:image" content="/preview.png">') };
  };
  const { root, events } = await runPipeline({ MOCK_USE_CONFIRMED: "1" }, {}, { pictureFetcher: local });
  const row = counts(events);
  assert.ok(row, "the publication logged no web-pictures row");
  const drawn = frames(readFileSync(findFile(root, "report.html"), "utf8"));
  t.diagnostic(`eligible cards ${row.eligibleCards}, cards with a picture ${row.cardsWithPicture}, frames ${drawn}, requests ${asked.length}, freeze ${row.freezeMs} ms, step ended first ${row.stepEndedBeforePublication}, unfinished ${row.unfinishedAtPublication}, step ms at publication ${row.stepMsAtPublication}`);
  assert.ok(row.eligibleCards > 0, "the mock run has no card whose page the step collects, so this proves nothing");
  assert.ok(asked.length > 0, "a run with an eligible card asked the fetcher nothing");
  assert.ok(row.cardsWithPicture > 0, "the local picture was not taken at publication");
  assert.equal(drawn, row.cardsWithPicture, `the page drew ${drawn} On the web frames for ${row.cardsWithPicture} cards the record counts`);
});
