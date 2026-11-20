// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A lawyer compares logos first, and the report showed none. Once the findings are final, each registration the report
// will show is checked against its saved record, and where the record says a figurative mark with an image, that one
// image is asked of the run's own register and saved with the run, its outcome written in `_driver/logos.json`. These
// arms drive the step with invented records and a stand-in image call, so no register is asked anything.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { logoOf, imageTypeOf, citedRefs, markLogos, writeRecordImages } from "../mark-logos.mjs";
import { knockoutRecordsDoc, openingQid } from "../knockout-register-read.mjs";
import { capabilitiesFor } from "../register-capabilities.mjs";
import { requestCancel } from "../cancel.mjs";
import { doMarkImage } from "../../providers/signa/src/core.js";
import { driverDir } from "../../shared/driver-dir.mjs";

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);

test("a record carries a logo only when it says a figurative mark and an image, in the register's own words", () => {
  assert.equal(logoOf({ markFeature: "WORD AND DESIGN", imageAvailable: true }), "logo");
  assert.equal(logoOf({ markFeature: "STYLIZED LETTERS", imageAvailable: true }), "logo");
  assert.equal(logoOf({ markFeature: "DESIGN ONLY", imageAvailable: true }), "logo", "a device mark with no words is figurative");
  assert.equal(logoOf({ markFeature: "combined", imageAvailable: true }), "logo", "Signa's word for a word-and-device mark");
  assert.equal(logoOf({ markFeature: "WORD ONLY", imageAvailable: true }), "no-logo", "a word mark with a typeset image is no logo");
  assert.equal(logoOf({ markFeature: "BLOCK LETTERS", imageAvailable: true }), "no-logo");
  assert.equal(logoOf({ markFeature: "WORD AND DESIGN", imageAvailable: false }), "no-logo");
  assert.equal(logoOf({ markFeature: "WORD AND DESIGN", imageAvailable: null }), "unknown", "a record that cannot say fetches nothing");
  assert.equal(logoOf({ markFeature: "SOUND MARK", imageAvailable: true }), "unknown");
  assert.equal(logoOf(null), "unknown");
});

test("only a PNG, JPEG, GIF or WebP image is kept", () => {
  assert.equal(imageTypeOf(PNG).type, "image/png");
  assert.equal(imageTypeOf(Buffer.from([0xff, 0xd8, 0xff, 0xe0])).type, "image/jpeg");
  assert.equal(imageTypeOf(Buffer.from("GIF89a....")).type, "image/gif");
  assert.equal(imageTypeOf(Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBP")])).type, "image/webp");
  assert.equal(imageTypeOf(Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>")), null, "an SVG is refused: it would be embedded in a client report");
  assert.equal(imageTypeOf(Buffer.from("not an image")), null);
});

test("the registrations asked about are the ones the report shows: a withdrawn finding's are not, and each once", () => {
  const findings = [
    { disposition: "adversarial", owner: { registrations: [{ uri: "/mark/EM/0001" }, { uri: "/mark/us/0002" }] } },
    { disposition: "withdrawn", owner: { registrations: [{ uri: "/mark/em/0003" }] } },
    { disposition: "distinguished", owner: { registrations: [{ uri: "/mark/em/0001" }, { uri: "no uri here" }] } },
  ];
  assert.deepEqual(citedRefs({ findings }), ["/mark/em/0001", "/mark/us/0002"]);
  const registerRecords = { marks: [{ name: "INVENTED", records: [{ recordId: "/mark/wo/0004" }, { recordId: "/mark/wo/0004" }] }] };
  assert.deepEqual(citedRefs({ registerRecords }), ["/mark/wo/0004"]);
});

/** An invented run: three cited registrations, one of them a figurative mark with an image. */
function run() {
  const dir = mkdtempSync(join(tmpdir(), "logos-"));
  mkdirSync(join(dir, "_records"), { recursive: true });
  mkdirSync(driverDir(dir), { recursive: true });
  const rec = (cc, id, markFeature, imageAvailable) =>
    writeFileSync(join(dir, "_records", `${cc}-${id}.json`), JSON.stringify({ _uri: `/mark/${cc}/${id}`, markFeature, imageAvailable }));
  rec("em", "0001", "WORD AND DESIGN", true);
  rec("em", "0002", "WORD ONLY", true);
  rec("us", "0003", "DESIGN MARK", null);
  writeFileSync(join(dir, "findings.json"), JSON.stringify({ findings: [{ disposition: "adversarial", owner: { registrations: [
    { uri: "/mark/em/0001" }, { uri: "/mark/em/0002" }, { uri: "/mark/us/0003" }, { uri: "/mark/us/0009" }] } }] }));
  return dir;
}
const register = (answer, calls) => ({ id: "invented-register", credEnv: "INVENTED_REGISTER_KEY", markImage: async (ref) => { calls.push(ref); return answer(ref); } });
const ENV = { INVENTED_REGISTER_KEY: "invented" };
const byRef = (doc) => Object.fromEntries(doc.rows.map((r) => [r.ref, r]));
/** A Knockout's rated names, as the run saves them: each name its listing holds, rated with nothing weighed. Returns the path. */
const named = (dir) => {
  const listing = JSON.parse(readFileSync(join(dir, "register-records.json"), "utf8"));
  writeFileSync(join(dir, "knockout-findings.json"), JSON.stringify({ marks: (listing.marks ?? []).map((m) => ({ name: m.name })) }));
  return join(dir, "knockout-findings.json");
};

test("one image request per registration whose record carries a logo, saved with the run, and none asked again on a resume", async () => {
  const dir = run();
  const calls = [];
  const provider = register(() => ({ ok: true, bytes: PNG, contentType: "image/png" }), calls);
  const doc = await markLogos(dir, { findingsPath: join(dir, "findings.json"), provider, env: ENV });
  assert.deepEqual(calls, ["/mark/em/0001"], "only the figurative mark with an image was asked for");
  const rows = byRef(doc);
  assert.equal(rows["/mark/em/0001"].state, "fetched");
  assert.equal(rows["/mark/em/0001"].contentType, "image/png");
  assert.ok(existsSync(join(dir, rows["/mark/em/0001"].file)), "the image is saved with the run");
  assert.equal(rows["/mark/em/0002"].state, "no-logo");
  assert.equal(rows["/mark/us/0003"].state, "unknown", "a record that cannot say asks nothing");
  assert.equal(rows["/mark/us/0009"].state, "unknown", "a registration the run holds no record of asks nothing");
  assert.deepEqual(JSON.parse(readFileSync(driverDir(dir, "logos.json"), "utf8")).rows, doc.rows);
  await markLogos(dir, { findingsPath: join(dir, "findings.json"), provider, env: ENV });
  assert.deepEqual(calls, ["/mark/em/0001"], "a resume asked for the image again");
});

test("a run that makes no register call asks nothing, and says why: a replay, no credential, a register with no image call", async () => {
  for (const [why, opts] of [
    ["replay", { injectedFetcher: true, env: ENV }],
    ["no credential", { env: {} }],
  ]) {
    const calls = [];
    const doc = await markLogos(run(), { findingsPath: null, provider: register(() => ({ ok: true, bytes: PNG }), calls), ...opts });
    assert.equal(calls.length, 0, `${why}: an image was asked for`);
    assert.ok(doc, why);
  }
  for (const [why, opts] of [["replay", { injectedFetcher: true, env: ENV }], ["no credential", { env: {} }]]) {
    const calls = [];
    const dir = run();
    const doc = await markLogos(dir, { findingsPath: join(dir, "findings.json"), provider: register(() => ({ ok: true, bytes: PNG }), calls), ...opts });
    assert.equal(calls.length, 0, `${why}: an image was asked for`);
    assert.equal(byRef(doc)["/mark/em/0001"].state, "unknown", why);
    assert.ok(byRef(doc)["/mark/em/0001"].cause, `${why}: no cause given`);
  }
  const dir = run();
  const doc = await markLogos(dir, { findingsPath: join(dir, "findings.json"), provider: { id: "invented-register", credEnv: "INVENTED_REGISTER_KEY" }, env: ENV });
  assert.equal(byRef(doc)["/mark/em/0001"].state, "unknown", "a register whose adapter fetches no image is not a failure");
});

test("a request that does not land, or brings back something that is not an image, is failed with its cause and stops nothing", async () => {
  for (const [why, answer] of [
    ["refused", () => ({ ok: false, cause: "HTTP 503: invented" })],
    ["an SVG", () => ({ ok: true, bytes: Buffer.from("<svg/>") })],
    ["a throw", () => { throw new Error("invented"); }],
  ]) {
    const dir = run();
    const doc = await markLogos(dir, { findingsPath: join(dir, "findings.json"), provider: register(answer, []), env: ENV });
    const row = byRef(doc)["/mark/em/0001"];
    assert.equal(row.state, "failed", why);
    assert.ok(row.cause, `${why}: no cause`);
    assert.equal(row.file, undefined, `${why}: a file was recorded`);
  }
});

test("a Knockout's listed filings are read the same way", async () => {
  const dir = run();
  writeFileSync(join(dir, "register-records.json"), JSON.stringify({ marks: [{ name: "INVENTED", records: [{ recordId: "/mark/em/0001" }] }] }));
  const calls = [];
  const doc = await markLogos(dir, { registerRecordsPath: join(dir, "register-records.json"), knockoutFindingsPath: named(dir), provider: register(() => ({ ok: true, bytes: PNG }), calls), env: ENV });
  assert.deepEqual(calls, ["/mark/em/0001"]);
  assert.equal(doc.rows.length, 1);
});

test("a Knockout's filing whose record is only in the run's record log, where its listing wrote it, is read there", async () => {
  // A live Knockout writes no `_records/`; its page reads each filing's record from the log, and so does this step.
  const dir = mkdtempSync(join(tmpdir(), "logos-ko-"));
  mkdirSync(driverDir(dir), { recursive: true });
  const row = (target, markFeature, imageAvailable) => JSON.stringify({ ts: "2026-11-20T00:00:00Z", provider: "invented-register", target, body: { markFeature, imageAvailable } });
  writeFileSync(driverDir(dir, "register-record-bodies.jsonl"), [row("/mark/em/0101", "WORD AND DESIGN", true), row("/mark/em/0102", "WORD ONLY", true)].join("\n") + "\n");
  writeFileSync(join(dir, "register-records.json"), JSON.stringify({ marks: [{ name: "INVENTED", records: [
    { recordId: "/mark/em/0101" }, { recordId: "/mark/em/0102" }, { recordId: "/mark/em/0103" }] }] }));
  const calls = [];
  const doc = await markLogos(dir, { registerRecordsPath: join(dir, "register-records.json"), knockoutFindingsPath: named(dir), provider: register(() => ({ ok: true, bytes: PNG }), calls), env: ENV });
  assert.deepEqual(calls, ["/mark/em/0101"], "only the figurative filing with an image was asked for");
  const rows = byRef(doc);
  assert.equal(rows["/mark/em/0101"].state, "fetched");
  assert.equal(rows["/mark/em/0102"].state, "no-logo", "a word mark is said to be one, not that the run holds no record");
  assert.equal(rows["/mark/em/0103"].state, "unknown", "a filing the run holds no record of asks nothing");
  // A clearance reads its cited registrations from `_records/` alone, as its page does: the log is not read for it.
  const other = mkdtempSync(join(tmpdir(), "logos-clearance-"));
  mkdirSync(driverDir(other), { recursive: true });
  writeFileSync(driverDir(other, "register-record-bodies.jsonl"), row("/mark/em/0101", "WORD AND DESIGN", true) + "\n");
  writeFileSync(join(other, "findings.json"), JSON.stringify({ findings: [{ disposition: "adversarial", owner: { registrations: [{ uri: "/mark/em/0101" }] } }] }));
  const asked = [];
  const clearance = await markLogos(other, { findingsPath: join(other, "findings.json"), provider: register(() => ({ ok: true, bytes: PNG }), asked), env: ENV });
  assert.deepEqual(asked, [], "a clearance read a record its page does not show");
  assert.equal(byRef(clearance)["/mark/em/0101"].state, "unknown");
});

// ── A REGISTER THAT STATES THE IMAGE ON ITS ROWS (Signa) ───────────────────────────────────────────────────────────────
// Its Knockout keeps no record body: the mark's kind, its image flag and the register's link to the image are on the search
// rows. The listing keeps them for the logo step in a file of their own, and the record the Knockout's rater reads does not
// change.
const SIGNA = capabilitiesFor("signa");
const signaRow = (id, kind, media, link) => ({ record_id: `/mark/us/${id}`, mark_text: "INVENTED", owner_name: "Invented Owner", status: "Registered",
  classes: [9], office: "us", raw: { id, mark_feature_type: kind, has_media: media, ...(link === undefined ? {} : { primary_image_url: link }) } });

test("a Knockout's listing keeps each row's image facts for the logo step, and the record the rater reads is unchanged", () => {
  const NAME = "INVENTED";
  const block = { qid: openingQid(NAME, "identical"), state: "enumerated", total_hits: 3, records: [
    signaRow("tm_1", "combined", true, "https://api.signa.so/v1/trademarks/tm_1/media/med_1"),
    signaRow("tm_2", "word", true, "https://api.signa.so/v1/trademarks/tm_2/media/med_2"),
    signaRow("tm_3", null, false) ] };
  const scope = { marks: [{ name: NAME, classes: [9] }], classes: [9], jurisdictions: ["US"], provider: "signa", capabilities: SIGNA,
    counts: { marks: [{ name: NAME, counts: { identical: { total: 3 } } }] }, reading: null,
    readBlocks: () => new Map([[block.qid, block]]), readProposals: () => ({ entries: [] }) };
  const images = new Map();
  const withImages = knockoutRecordsDoc({ ...scope, images, now: () => new Date(0) });
  const without = knockoutRecordsDoc({ ...scope, now: () => new Date(0) });
  assert.deepEqual(withImages, without, "the listing the rater reads changed");
  assert.equal(withImages.marks[0].records.length, 3, "premise: the three rows were listed");
  assert.doesNotMatch(JSON.stringify(withImages), /primary_image_url|media\/med_|markFeature|imageAvailable/, "an image fact reached the rater's record");
  assert.deepEqual(images.get("/mark/us/tm_1"), { markFeature: "combined", imageAvailable: true, imageUrl: "https://api.signa.so/v1/trademarks/tm_1/media/med_1" });
  assert.equal(images.get("/mark/us/tm_2").markFeature, "word");
  assert.deepEqual(images.get("/mark/us/tm_3"), { markFeature: null, imageAvailable: false, imageUrl: null });
});

/** An invented Knockout as a Signa listing leaves it: filings in register-records.json, their image facts beside it. */
function signaKnockout(facts) {
  const dir = mkdtempSync(join(tmpdir(), "logos-signa-"));
  mkdirSync(driverDir(dir), { recursive: true });
  writeFileSync(join(dir, "register-records.json"), JSON.stringify({ marks: [{ name: "INVENTED", records: Object.keys(facts).map((recordId) => ({ recordId })) }] }));
  writeRecordImages(dir, new Map(Object.entries(facts)));
  return dir;
}
/** A stand-in for Signa's adapter: it follows the record's own image link, and asks nothing without one. */
const linkFollower = (calls) => ({ id: "signa", credEnv: "INVENTED_REGISTER_KEY", markImage: async (ref, { record } = {}) => {
  if (!record?.imageUrl) return { ok: false, notTried: true, cause: "the record names no image link" };
  calls.push([ref, record.imageUrl]);
  return { ok: true, bytes: PNG };
} });

test("a Signa Knockout's figurative filing is fetched from the link its row gave, a word mark is one, and no link asks nothing", async () => {
  const dir = signaKnockout({
    "/mark/us/tm_1": { markFeature: "combined", imageAvailable: true, imageUrl: "https://api.signa.so/v1/trademarks/tm_1/media/med_1" },
    "/mark/us/tm_2": { markFeature: "word", imageAvailable: true, imageUrl: "https://api.signa.so/v1/trademarks/tm_2/media/med_2" },
    "/mark/us/tm_3": { markFeature: "figurative", imageAvailable: true, imageUrl: null },
  });
  const calls = [];
  const doc = await markLogos(dir, { registerRecordsPath: join(dir, "register-records.json"), knockoutFindingsPath: named(dir), provider: linkFollower(calls), env: ENV });
  assert.deepEqual(calls, [["/mark/us/tm_1", "https://api.signa.so/v1/trademarks/tm_1/media/med_1"]]);
  const rows = byRef(doc);
  assert.equal(rows["/mark/us/tm_1"].state, "fetched");
  assert.equal(rows["/mark/us/tm_2"].state, "no-logo");
  assert.equal(rows["/mark/us/tm_3"].state, "unknown", "a record with no link to follow made no request, so it is not a failed fetch");
});

test("a stop that lands during the step does not end it: the step runs past the publish read, and the report is delivered whole", async () => {
  // Both pipelines run this step after `assertNotCancelledBeforePublish`, when the run can no longer be stopped, and the
  // calls that build what is delivered are not behind the stop (cancel.mjs). A stop refused here would end the run with
  // no report after the screen said it could no longer be stopped.
  const dir = signaKnockout({ "/mark/us/tm_1": { markFeature: "combined", imageAvailable: true, imageUrl: "https://api.signa.so/v1/trademarks/tm_1/media/med_1" } });
  requestCancel(dir, { via: "test" });
  const calls = [];
  const doc = await markLogos(dir, { registerRecordsPath: join(dir, "register-records.json"), knockoutFindingsPath: named(dir), provider: linkFollower(calls), env: ENV });
  assert.equal(calls.length, 1, "the image was not asked for");
  assert.equal(byRef(doc)["/mark/us/tm_1"].state, "fetched");
});

test("Signa's image is asked only of the register's own host, over https, and a refusal is a failed fetch", async () => {
  const BASE = "https://api.signa.so";
  const real = globalThis.fetch;
  const asked = [];
  globalThis.fetch = async (url) => {
    asked.push(String(url));
    return String(url).endsWith("/missing") ? new Response("no", { status: 404 }) : new Response(PNG, { status: 200, headers: { "content-type": "image/png" } });
  };
  try {
    const tctx = { kind: "image", agentId: null, sessionKey: null, sessionId: null, recordLog: null };
    for (const [why, link] of [["another host", "https://elsewhere.example/v1/trademarks/tm_1/media/med_1"], ["not https", "http://api.signa.so/v1/trademarks/tm_1/media/med_1"], ["no link", null]]) {
      const r = await doMarkImage(BASE, link, tctx);
      assert.equal(r.ok, false, why);
      assert.equal(r.notTried, true, `${why}: counted as a request made`);
    }
    assert.deepEqual(asked, [], "a link off the register's own host was followed");
    const got = await doMarkImage(BASE, `${BASE}/v1/trademarks/tm_1/media/med_1`, tctx);
    assert.equal(got.ok, true);
    assert.equal(imageTypeOf(got.bytes).type, "image/png");
    const refused = await doMarkImage(BASE, `${BASE}/v1/trademarks/tm_1/missing`, tctx);
    assert.deepEqual([refused.ok, refused.notTried, refused.cause], [false, undefined, "HTTP 404"]);
    assert.equal(asked.length, 2);
  } finally { globalThis.fetch = real; }
});

test("Clarivate's image is asked for with the id as the register spells it, not the run's lowercased key", async () => {
  // The run keys records by a lowercased ref, and the image endpoint refuses a lowercased id ("Not a valid id", 12 of 12
  // on a demo re-run, 2026-11-20). The saved record keeps the register's spelling, and that is what is sent.
  const { adapter: clarivate } = await import("../../providers/clarivate/src/adapter.js");
  const dir = mkdtempSync(join(tmpdir(), "logos-clarivate-"));
  mkdirSync(join(dir, "_records"), { recursive: true });
  mkdirSync(driverDir(dir), { recursive: true });
  writeFileSync(join(dir, "_records", "em-qzx0001.json"), JSON.stringify({ _uri: "/mark/em/QZX0001", uri: "/mark/em/QZX0001", guid: "QZX0001",
    provider: "clarivate", markFeature: "WORD AND DESIGN", imageAvailable: true }));
  writeFileSync(join(dir, "findings.json"), JSON.stringify({ findings: [{ disposition: "adversarial", owner: { registrations: [{ uri: "/mark/em/QZX0001" }] } }] }));
  const real = globalThis.fetch, key = process.env.CLARIVATE_API_KEY;
  const sent = [];
  globalThis.fetch = async (url, init) => {
    sent.push(JSON.parse(init?.body ?? "{}").id);
    // The answer's shape as one live request returned it, 2026-11-20: `{ images: [{ content, id, type }] }`.
    return new Response(JSON.stringify({ images: [{ content: PNG.toString("base64"), id: "QZX0001", type: "image/png" }] }), { status: 200, headers: { "content-type": "application/json" } });
  };
  process.env.CLARIVATE_API_KEY = "invented";
  try {
    const doc = await markLogos(dir, { findingsPath: join(dir, "findings.json"), provider: clarivate, env: { CLARIVATE_API_KEY: "invented" } });
    assert.deepEqual(sent, ["QZX0001"], "the image was asked for under another spelling of the id");
    assert.equal(byRef(doc)["/mark/em/qzx0001"].state, "fetched");
  } finally {
    globalThis.fetch = real;
    if (key === undefined) delete process.env.CLARIVATE_API_KEY; else process.env.CLARIVATE_API_KEY = key;
  }
});

test("a Clarivate answer of a shape the adapter does not read fails with that shape on the row, and never with a value", async () => {
  // Before the shape was measured, the step read `images[].image`; the answer carried `content`. A failure now says what
  // the answer held, so the next change of shape is read off the run instead of guessed at.
  const { adapter: clarivate } = await import("../../providers/clarivate/src/adapter.js");
  const dir = mkdtempSync(join(tmpdir(), "logos-clarivate-shape-"));
  mkdirSync(join(dir, "_records"), { recursive: true });
  mkdirSync(driverDir(dir), { recursive: true });
  writeFileSync(join(dir, "_records", "em-qzx0002.json"), JSON.stringify({ _uri: "/mark/em/QZX0002", uri: "/mark/em/QZX0002", guid: "QZX0002",
    provider: "clarivate", markFeature: "DESIGN ONLY", imageAvailable: true }));
  writeFileSync(join(dir, "findings.json"), JSON.stringify({ findings: [{ disposition: "adversarial", owner: { registrations: [{ uri: "/mark/em/QZX0002" }] } }] }));
  const secret = PNG.toString("base64");
  const real = globalThis.fetch, key = process.env.CLARIVATE_API_KEY;
  globalThis.fetch = async () => new Response(JSON.stringify({ images: [{ image: secret, mime: "image/png" }] }), { status: 200, headers: { "content-type": "application/json" } });
  process.env.CLARIVATE_API_KEY = "invented";
  try {
    const doc = await markLogos(dir, { findingsPath: join(dir, "findings.json"), provider: clarivate, env: { CLARIVATE_API_KEY: "invented" } });
    const row = byRef(doc)["/mark/em/qzx0002"];
    assert.equal(row.state, "failed");
    assert.equal(row.shape, `{images: [1x {image: string(${secret.length}), mime: string(9)}]}`);
    assert.equal(JSON.stringify(doc).includes(secret), false, "a value of the answer reached the run's record");
  } finally {
    globalThis.fetch = real;
    if (key === undefined) delete process.env.CLARIVATE_API_KEY; else process.env.CLARIVATE_API_KEY = key;
  }
});

test("a Knockout asks for logos only for the filings its tables show: the most material few, the weighed ones first", async () => {
  // A name's table shows at most eight filings, the ones the run weighed first (publish/render-knockout.mjs, shownFilings).
  // On a demo re-run, 8 of a Knockout's 9 image requests were for filings no page listed.
  const dir = mkdtempSync(join(tmpdir(), "logos-ko-shown-"));
  mkdirSync(join(dir, "_records"), { recursive: true });
  mkdirSync(driverDir(dir), { recursive: true });
  const ids = Array.from({ length: 10 }, (_, i) => `qzk${String(i + 1).padStart(2, "0")}`);
  for (const id of ids) writeFileSync(join(dir, "_records", `em-${id}.json`), JSON.stringify({ _uri: `/mark/em/${id}`, markFeature: "WORD AND DESIGN", imageAvailable: true }));
  writeFileSync(join(dir, "register-records.json"), JSON.stringify({ marks: [{ name: "INVENTED", records: ids.map((id) => ({ recordId: `/mark/em/${id}`, status: "Registered" })) }] }));
  writeFileSync(join(dir, "knockout-findings.json"), JSON.stringify({ marks: [{ name: "INVENTED", registerReads: [{ recordId: "/mark/em/qzk10" }] }] }));
  const calls = [];
  await markLogos(dir, { registerRecordsPath: join(dir, "register-records.json"), knockoutFindingsPath: join(dir, "knockout-findings.json"),
    provider: register(() => ({ ok: true, bytes: PNG }), calls), env: ENV });
  assert.equal(calls.length, 8, "a logo was asked for a filing the table does not show, or one it shows was skipped");
  assert.equal(calls[0], "/mark/em/qzk10", "the filing the run weighed leads, as it does on the page");
  assert.deepEqual(calls.filter((c) => ["/mark/em/qzk08", "/mark/em/qzk09"].includes(c)), [], "the two filings below the table's eight were asked for");
  // A run whose rated names cannot be read asks about none, rather than about every filing.
  const blind = [];
  const doc = await markLogos(dir, { registerRecordsPath: join(dir, "register-records.json"), knockoutFindingsPath: join(dir, "absent.json"),
    provider: register(() => ({ ok: true, bytes: PNG }), blind), env: ENV });
  assert.deepEqual([blind.length, doc.rows.length], [0, 0]);
  // A caller that names no file reads the run's own rated names, so a pass run by hand asks as the pipeline does.
  const byDefault = [];
  rmSync(driverDir(dir, "logos.json"));
  await markLogos(dir, { registerRecordsPath: join(dir, "register-records.json"), provider: register(() => ({ ok: true, bytes: PNG }), byDefault), env: ENV });
  assert.equal(byDefault.length, 8, "a caller that named no file did not read the run's own rated names");
});
