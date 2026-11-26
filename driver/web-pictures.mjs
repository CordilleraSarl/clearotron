// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// web-pictures.mjs — the picture each web page a card says the name is used on declares for itself.
//
// A picture of the name on an app icon, on packaging or on a storefront shows use in trade faster than an address does,
// and the run never kept one. This module takes, from each page a report's cards collect, the one picture the page
// declares as its preview (what is shown when its link is shared), and nothing else: no search, no register, no
// web-research service and no AI program. What it fetched, and what it did not, is a record the report draws from.
//
// WHICH PAGES (owner, 2026-11-26): only where the card says the name is in use on that page.
//   - A conflict found on the web (source type `common-law…`): the page it was found on (`source.resolved_link`) and every
//     http(s) address of its use check, whatever the use reads.
//   - Any other conflict: every http(s) address of its use check, and only where its use reads confirmed.
//   - Never an office's or a register's own record: an address on one of REGISTER_RECORD_HOSTS, or any address of a use
//     check whose own quality reads `register-mirror`. A register's page is not a page where the name is in use.
// The cards are the findings a clearance report draws as full or compact cards: not withdrawn, not ruled out, and either
// on-field or found on the web. One page is one address as the card cites it, less any #fragment.
//
// HOW LONG: one limit for the whole report, CLEARANCE_PICTURE_SECONDS from the first request (owner, 2026-11-26), and a
// Knockout's own KNOCKOUT_PICTURE_SECONDS (its approved board). They are two rulings that hold the same number today, kept
// as two values. At the limit every open request is abandoned and a page not yet requested is recorded as not tried;
// nothing that arrives later is kept.
//
// WHAT COUNTS AS A PICTURE: the page's `og:image`, or its `twitter:image` where it has none, the first such tag, read
// against the page's final address; or the cited address itself where it answers with an image. Only a PNG, JPEG, GIF or
// WebP counts (imageTypeOf, the logo step's check). Every request, every redirect hop included, goes through the engine's
// own public-address check (checkedLookup), so a page cannot point the fetch at a private or cloud-metadata address.
// Bytes are kept as bytes: the engine's text fetch decodes every answer as UTF-8, which would corrupt a picture.
//
// A SITE'S GENERAL CARD is not the name in use: an inner page whose picture is its site front page's is dropped
// (frontPageRule). WHAT IS EMBEDDED is each picture brought down to its box on this machine, as it arrives and inside the
// same limit (pictureShrinker), never the bytes as served, which grew measured reports more than tenfold.
//
// RECORDING ONLY, and it never throws: a page that refuses, times out or offers no picture is recorded, and the card shows
// nothing for it. A refusal is never worked around.
import http from "node:http";
import https from "node:https";
import zlib from "node:zlib";
import { createHash } from "node:crypto";
import { isIP } from "node:net";
import { availableParallelism } from "node:os";
import { Worker } from "node:worker_threads";
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { checkedLookup, isPublicAddress } from "./engine/mcp/public-fetch.mjs";
import { imageTypeOf } from "./mark-logos.mjs";
import { DRIVER_DIR, driverDir, ensureDriverDir } from "./run-record.mjs";

export const CLEARANCE_PICTURE_SECONDS = 20;   // owner, 2026-11-26: at most 20 seconds a clearance report
export const KNOCKOUT_PICTURE_SECONDS = 20;    // the Knockout's approved board: its own limit, which holds the same number
export const PICTURE_CONCURRENCY = 6;          // pages fetched side by side
export const PICTURE_USER_AGENT = "cordillera-clearotron-fetch/0.1";   // the engine's own fetch names itself so

// An office's or a register's own record pages: the twelve offices whose record-page addresses the report builds
// (publish/office-record-links.mjs), the register service's record host, TMview's data network, and the six further
// register mirrors of the engine's own list. A host matches as itself or as any subdomain of it, less a leading www.
export const REGISTER_RECORD_HOSTS = Object.freeze([
  "wipo.int", "ipaustralia.gov.au", "ised-isde.canada.ca", "swissreg.ch", "oepm.es", "inpi.fr", "euipo.europa.eu", "ipo.gov.uk",
  "impi.gob.mx", "patentstyret.no", "prv.se", "uspto.gov", "tm.corsearch.com", "tmdn.org",
  "markenmeldungen.ch", "trademarks.justia.com", "trademarkia.com", "tmview.org", "register.dpma.de", "trademarkelite.com",
]);

/** The site an address is on: its host, less a leading www. and any port. Null for anything that is not a URL. PURE. */
export function siteOf(address) {
  try { return new URL(String(address)).hostname.toLowerCase().replace(/^www\./, ""); } catch { return null; }
}

/** Whether an address is an office's or a register's own record page. PURE. */
export function onRegisterRecordHost(address) {
  const h = siteOf(address);
  return Boolean(h) && REGISTER_RECORD_HOSTS.some((x) => h === x || h.endsWith(`.${x}`));
}

/** The http(s) addresses a cited value holds, read as the report's own cite reads them, each less its #fragment. PURE. */
export function citedAddresses(value) {
  return [...new Set((String(value ?? "").match(/https?:\/\/[^\s,|]+/g) ?? []).map((u) => u.replace(/[).,;:]+$/, "").replace(/#.*$/, "")))];
}

const foundOnTheWeb = (f) => /^common-law/i.test(String(f?.source?.source_type ?? ""));
const onField = (f) => (f?.disposition ? f.disposition === "adversarial" : (Number(f?.composite) || 0) >= 3);

/**
 * The pages each card collects, by the finding's ordinal, in the order the card prints them: its use check's pages, then
 * the page it was found on. PURE.
 * @returns {Map<number, string[]>}
 */
export function clearancePages(findings) {
  const out = new Map();
  for (const f of Array.isArray(findings) ? findings : []) {
    if (f?.disposition === "withdrawn" || f?.ruled_out === true) continue;
    const web = foundOnTheWeb(f);
    if (!web && !onField(f)) continue;
    const use = web || f?.meters?.use?.token === "confirmed" ? citedAddresses(f?.use_check?.source) : [];
    const mirror = f?.use_check?.quality === "register-mirror";
    const pages = [...(mirror ? [] : use), ...(web ? citedAddresses(f?.source?.resolved_link) : [])]
      .filter((u) => !onRegisterRecordHost(u));
    if (pages.length) out.set(Number(f.ordinal), [...new Set(pages)]);
  }
  return out;
}

/**
 * A Knockout's pages, by card (`k<name position>-<number>`, the card's id on the page): a finding card's evidence entries
 * that are http(s) addresses, in the order the card prints them after "Sources:", less any register's own record. A
 * register filing's card opens none (owner, 2026-11-26). PURE.
 * @returns {Map<string, string[]>}
 */
export function knockoutPages(doc) {
  const out = new Map();
  (Array.isArray(doc?.marks) ? doc.marks : []).forEach((m, mi) => {
    (Array.isArray(m?.findings) ? m.findings : []).forEach((f, i) => {
      const pages = [...new Set((Array.isArray(f?.evidence) ? f.evidence : []).filter((u) => /^https?:\/\//i.test(String(u)))
        .map((u) => String(u).replace(/#.*$/, "")).filter((u) => !onRegisterRecordHost(u)))];
      if (pages.length) out.set(`k${mi}-${Number(f?.ordinal) || i + 1}`, pages);
    });
  });
  return out;
}

const ENTITIES = { amp: "&", quot: '"', apos: "'", lt: "<", gt: ">", "#39": "'", "#x27": "'", "#x2F": "/", "#47": "/" };
const decode = (s) => String(s).replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e) => ENTITIES[e] ?? ENTITIES[e.toLowerCase()] ?? m);

/**
 * The preview picture a page declares: its first og:image, or its first twitter:image where it has no og:image, read
 * against the page's final address. Null where it declares none, or names something that is not an http(s) address. PURE.
 */
export function previewPictureOf(html, baseUrl) {
  const head = String(html ?? "").slice(0, 600_000);
  const metas = head.match(/<meta\b[^>]*>/gi) ?? [];
  const attr = (tag, name) => (tag.match(new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i")) ?? [])
    .slice(2).find((v) => v !== undefined);
  const pick = (keys) => {
    for (const tag of metas) {
      const key = String(attr(tag, "property") ?? attr(tag, "name") ?? "").trim().toLowerCase();
      const content = attr(tag, "content");
      if (keys.includes(key) && content && content.trim()) return decode(content.trim());
    }
    return null;
  };
  const found = pick(["og:image", "og:image:url", "og:image:secure_url"]) ?? pick(["twitter:image", "twitter:image:src"]);
  if (!found) return null;
  try { const u = new URL(found, baseUrl); return u.protocol === "http:" || u.protocol === "https:" ? u.href : null; } catch { return null; }
}

const REDIRECTS = new Set([301, 302, 303, 307, 308]);
const DECODERS = { gzip: () => zlib.createGunzip(), "x-gzip": () => zlib.createGunzip(), deflate: () => zlib.createInflate(), br: () => zlib.createBrotliDecompress() };

function requestBytes(url, { lookup, signal, maxBytes, accept, timeoutMs }) {
  return new Promise((resolve, reject) => {
    const lib = url.protocol === "https:" ? https : http;
    const req = lib.request(url, { method: "GET", lookup, agent: false, signal,
      headers: { "user-agent": PICTURE_USER_AGENT, "accept-encoding": "gzip, deflate, br", accept } }, (res) => {
      const location = res.headers.location ?? null;
      if (REDIRECTS.has(res.statusCode) && location) { res.resume(); return resolve({ status: res.statusCode, location }); }
      const enc = String(res.headers["content-encoding"] ?? "").trim().toLowerCase();
      const stream = DECODERS[enc] ? res.pipe(DECODERS[enc]()) : res;
      const chunks = []; let bytes = 0, done = false;
      let truncated = false;
      const finish = () => { if (!done) { done = true; resolve({ status: res.statusCode, contentType: String(res.headers["content-type"] ?? ""), bytes: Buffer.concat(chunks), truncated }); } };
      stream.on("data", (c) => { if (done) return; chunks.push(c); bytes += c.length; if (bytes >= maxBytes) { truncated = true; finish(); req.destroy(); } });
      stream.on("end", finish);
      stream.on("error", (e) => { if (!done) { done = true; reject(e); } });
    });
    // The whole request, as the engine's fetch bounds it: a page that drips a byte a second never trips an idle timer.
    const deadline = setTimeout(() => req.destroy(new Error(`no answer within ${Math.round(timeoutMs / 1000)}s`)), timeoutMs);
    req.on("close", () => clearTimeout(deadline));
    req.on("error", reject);
    req.end();
  });
}

/**
 * GET an http(s) address as bytes, following at most 5 redirects, every hop through the public-address check and each
 * request bounded at `timeoutMs`, the engine's fetch's own 30 seconds. Resolves
 * `{ ok, status, url, contentType, bytes }` for an answer or `{ refused }`; rejects on a network failure or an abort.
 * `lookup` and `allow` are seams for tests only.
 */
export async function fetchBytes(rawUrl, { signal, maxBytes = 5 * 1024 * 1024, accept = "*/*", timeoutMs = 30000, lookup, allow = isPublicAddress } = {}) {
  let url;
  try { url = new URL(String(rawUrl)); } catch { return { refused: "not a URL" }; }
  const connectLookup = checkedLookup({ ...(lookup ? { lookup } : {}), allow });
  for (let hop = 0; ; hop++) {
    if (url.protocol !== "http:" && url.protocol !== "https:") return { refused: "not an http(s) address" };
    const host = url.hostname.replace(/^\[|\]$/g, "");
    if (isIP(host)) { const v = allow(host); if (!v.ok) return { refused: `a ${v.kind} address` }; }
    let r;
    try { r = await requestBytes(url, { lookup: connectLookup, signal, maxBytes, accept, timeoutMs }); }
    catch (e) { if (e?.refused) return { refused: e.message }; throw e; }
    if (!r.location) return { ok: r.status >= 200 && r.status < 300, status: r.status, url: url.href, contentType: r.contentType, bytes: r.bytes, truncated: r.truncated };
    if (hop >= 5) return { refused: "more than 5 redirects" };
    try { url = new URL(r.location, url); } catch { return { refused: "redirected to something that is not a URL" }; }
  }
}

/**
 * Fetch the preview picture of each page, side by side, within one limit for them all. Never throws.
 *
 * A row per page, in the order given: `{ page, site, state, picture, contentType, bytes, sha256, ms, data }`, where
 * `state` is `fetched` (the picture counts), `none` (the page declares no picture), `not-a-picture` (what came back is
 * not one of the four image types), `refused` (the check refused an address, or the page or its picture answered with
 * an error), `too-large` (the picture ran past the download cap of 5 MB, so only its start arrived), `failed` (the network
 * failed), `not-arrived` (still open at the limit) or `not-tried` (not yet requested at the limit). `ms` counts from the step's first request to the picture's arrival. `data` is the picture's bytes, for the
 * caller to save; nothing else holds them.
 *
 * SHRUNK ON THE SAME CLOCK. Each picture is brought down to its box (picture-thumbnail.mjs) as it arrives, in a worker
 * beside the fetches, and the limit ends both. A shrunk row keeps what the site served (`contentType`, `bytes`, `sha256`,
 * and the `width` and `height` its header declares) and gains what is stored (`stored: { contentType, bytes, width,
 * height, kept }`), with the milliseconds its shrinking took (`shrinkMs`); `data` is then the stored picture. One that
 * cannot be shrunk, or is still being shrunk at the limit, gains `notStored` with the reason and keeps no bytes.
 *
 * @param {string[]} pages
 * `compareFrontPages` asks each inner page's front page and applies frontPageRule (a clearance); `repeatedOnSite` applies
 * repeatedPreviewRule to the pages collected, with no extra fetch (a Knockout). `signal` ends the step early, as its
 * limit would; `onRows` is handed the live rows as soon as they exist.
 *
 * @param {{seconds?: number, concurrency?: number, fetcher?: typeof fetchBytes, now?: () => number, compareFrontPages?: boolean, repeatedOnSite?: boolean, shrink?: boolean, makeShrinker?: typeof pictureShrinker, signal?: AbortSignal|null, onRows?: ((rows: object[]) => void)|null}} [opts]
 */
export async function fetchPagePictures(pages, { seconds = CLEARANCE_PICTURE_SECONDS, concurrency = PICTURE_CONCURRENCY, fetcher = fetchBytes, now = () => performance.now(),
  compareFrontPages = true, repeatedOnSite = false, shrink = true, makeShrinker = pictureShrinker, signal = null, onRows = null } = {}) {
  const list = [...new Set((Array.isArray(pages) ? pages : []).map(String))];
  // Each inner page's site front page is asked right after it, in the same pool and on the same clock, for the rule of
  // a site's general card (frontPageRule); a front page a card cites is not asked twice.
  const order = [];
  for (const page of list) {
    order.push({ page, forComparison: false });
    const front = compareFrontPages && !isFrontPage(page) ? frontPageOf(page) : null;
    if (front && !list.includes(front) && !order.some((o) => o.page === front)) order.push({ page: front, forComparison: true });
  }
  const rows = order.map(({ page, forComparison }) => ({ page, site: siteOf(page), ...(forComparison ? { forComparison: true } : {}),
    state: "not-tried", picture: null, contentType: null, bytes: 0, sha256: null, ms: null, data: null }));
  onRows?.(rows);   // the live rows, for a caller that takes what has finished before the step does (startPictureStep)
  const abort = new AbortController();
  if (signal?.aborted) abort.abort(); else signal?.addEventListener("abort", () => abort.abort(), { once: true });
  const t0 = now();
  let timer = null;
  if (Number.isFinite(seconds)) timer = setTimeout(() => abort.abort(), seconds * 1000);
  const shrinker = shrink && rows.length ? makeShrinker({ size: SHRINK_WORKERS }) : null;
  abort.signal.addEventListener("abort", () => shrinker?.close(), { once: true });
  const shrinking = [];
  const shrinkRow = async (row) => {
    const m = await shrinker.shrink(row.data);
    if (m.served) { row.width = m.served.width; row.height = m.served.height; }   // as the site served it, from its header
    if (Number.isFinite(m.ms)) row.shrinkMs = m.ms;
    if (m.unfinished || m.refused) { row.notStored = m.unfinished ? "not shrunk within the limit" : m.refused; row.data = null; return; }
    row.stored = { contentType: m.contentType, bytes: m.bytes.byteLength, width: m.width, height: m.height, kept: m.kept };
    row.data = Buffer.from(m.bytes.buffer, m.bytes.byteOffset, m.bytes.byteLength);
  };
  let next = 0;
  const one = async (row) => {
    row.state = "not-arrived";
    try {
      const page = await fetcher(row.page, { signal: abort.signal, maxBytes: 2 * 1024 * 1024, accept: "text/html,application/xhtml+xml,image/*;q=0.8,*/*;q=0.5" });
      if (page.refused || !page.ok) { row.state = "refused"; return; }
      let pic = imageTypeOf(page.bytes) ? page : null;
      if (!pic) {
        const at = previewPictureOf(page.bytes.toString("utf8"), page.url);
        if (!at) { row.state = "none"; return; }
        row.picture = at;
        pic = await fetcher(at, { signal: abort.signal, maxBytes: 5 * 1024 * 1024, accept: "image/png,image/jpeg,image/gif,image/webp,image/*;q=0.8" });
        if (pic.refused || !pic.ok) { row.state = "refused"; return; }
      } else row.picture = page.url;
      // A picture cut off at the download cap is not a picture: its tail is missing, and no decoder can read it whole.
      if (pic.truncated) { row.state = "too-large"; return; }
      const type = imageTypeOf(pic.bytes);
      if (!type) { row.state = "not-a-picture"; return; }
      if (abort.signal.aborted) return;   // arrived after the limit: not kept
      Object.assign(row, { state: "fetched", contentType: type.type, bytes: pic.bytes.length, sha256: createHash("sha256").update(pic.bytes).digest("hex"), ms: Math.round(now() - t0), data: pic.bytes });
      if (shrinker && !row.forComparison) shrinking.push(shrinkRow(row));
    } catch {
      if (!abort.signal.aborted) row.state = "failed";
    }
  };
  const worker = async () => { while (next < rows.length && !abort.signal.aborted) await one(rows[next++]); };
  try {
    await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, rows.length)) }, worker));
    await Promise.all(shrinking);
  } finally { if (timer) clearTimeout(timer); shrinker?.close(); }
  if (compareFrontPages) frontPageRule(rows);
  if (repeatedOnSite) repeatedPreviewRule(rows);
  const shrinkMs = rows.reduce((a, r) => a + (Number.isFinite(r.shrinkMs) ? r.shrinkMs : 0), 0);
  return { rows, ms: Math.round(now() - t0), aborted: abort.signal.aborted, ...(shrinker ? { shrinkMs } : {}) };
}

// Workers that shrink pictures side by side with the fetches: two, or one on a machine with two cores or fewer.
const SHRINK_WORKERS = Math.max(1, Math.min(2, (availableParallelism?.() ?? 2) - 1));

/**
 * A small pool of workers that bring pictures down to their box (picture-shrink-worker.mjs), started with the step so
 * that their start-up overlaps the first fetches. `shrink(bytes)` resolves the worker's answer; `close()` stops every worker and resolves what is still
 * queued or in hand as `{ unfinished: true }`. The bytes are copied before they are handed over, so the row keeps its own.
 */
export function pictureShrinker({ size = SHRINK_WORKERS } = {}) {
  const idle = [], queue = [], inHand = new Map();
  let started = 0, closed = false, nextId = 0, failures = 0, broken = null;
  const all = new Set();
  const pump = () => {
    while (!closed && queue.length && (idle.length || started < size)) {
      if (!idle.length) start();
      const w = idle.pop(), task = queue.shift();
      inHand.set(task.id, { ...task, worker: w });
      w.postMessage({ id: task.id, bytes: task.bytes }, [task.bytes.buffer]);
    }
  };
  const start = () => {
    started++;
    // The parent's flags, less one that only an inline script may carry and that a worker file refuses.
    const w = new Worker(new URL("./picture-shrink-worker.mjs", import.meta.url), { execArgv: process.execArgv.filter((a) => !a.startsWith("--input-type")) });
    all.add(w); idle.push(w);
    w.on("message", (m) => { const t = inHand.get(m.id); inHand.delete(m.id); if (!closed) idle.push(w); t?.resolve(m); pump(); });
    // A worker that fails is gone: it leaves the idle list, and what it held is refused with the reason. A pool whose
    // workers keep failing (one that cannot even load) stops starting them and refuses the rest at once.
    w.on("error", (e) => {
      const why = `it could not be shrunk: ${String(e?.message ?? e).slice(0, 80)}`;
      all.delete(w);
      const at = idle.indexOf(w); if (at >= 0) idle.splice(at, 1);
      for (const [id, t] of inHand) if (t.worker === w) { inHand.delete(id); t.resolve({ refused: why }); }
      started--;
      if (++failures > size) { broken = why; for (const t of queue) t.resolve({ refused: why }); queue.length = 0; return; }
      pump();
    });
  };
  for (let i = 0; i < size; i++) start();
  return {
    shrink(bytes) {
      if (closed) return Promise.resolve({ unfinished: true });
      if (broken) return Promise.resolve({ refused: broken });
      return new Promise((resolve) => { queue.push({ id: nextId++, bytes: new Uint8Array(bytes), resolve }); pump(); });
    },
    close() {
      if (closed) return;
      closed = true;
      for (const w of all) w.terminate().catch(() => {});
      for (const t of [...inHand.values(), ...queue]) t.resolve({ unfinished: true });
      inHand.clear(); queue.length = 0;
    },
  };
}

/** A site's front page: its scheme and host, path `/`. Null for anything that is not a URL. PURE. */
export function frontPageOf(page) {
  try { const u = new URL(String(page)); return `${u.protocol}//${u.host}/`; } catch { return null; }
}
const isFrontPage = (page) => { try { return new URL(String(page)).pathname === "/"; } catch { return false; } };

/**
 * THE RULE FOR A SITE'S GENERAL CARD (2026-11-26, adopted as a trial on the clearance report after a measured check of
 * 13 pages). Many sites declare one picture for every page, and a card would show the site's general card as
 * if it were the name in use. A cited inner page's picture is dropped (`general: true`) when its bytes, before any
 * resizing, equal the picture of the site's front page. A front page fetched only for this comparison never gives a
 * card a picture, and keeps no bytes. Where the cited page is itself the front page, its picture is the use evidence and
 * stays. A comparison not finished at the limit leaves the picture out (`comparison: "unfinished"`). MUTATES the rows.
 */
export function frontPageRule(rows) {
  const byPage = new Map(rows.map((r) => [r.page, r]));
  for (const row of rows) {
    if (row.forComparison || row.state !== "fetched" || isFrontPage(row.page)) continue;
    const front = byPage.get(frontPageOf(row.page));
    if (!front) continue;
    if (front.state === "not-arrived" || front.state === "not-tried") row.comparison = "unfinished";
    else if (front.state === "fetched" && front.sha256 === row.sha256) row.general = true;
  }
  for (const row of rows) if (row.forComparison) row.data = null;
  return rows;
}

/**
 * A SITE'S REPEATED PREVIEW, for a Knockout (2026-11-26), which fetches no front page to compare with: among the pages
 * already collected, a picture whose bytes, before any resizing, repeat on two or more different pages of one site is
 * that site's generic preview, and is dropped (`general: true`) on each of them, except on a cited front page, where it
 * is the use evidence. One page cited by several cards is one page, so a repeated citation alone drops nothing.
 * MUTATES the rows.
 */
export function repeatedPreviewRule(rows) {
  const bySiteAndBytes = new Map();
  for (const r of rows) {
    if (r.forComparison || r.state !== "fetched" || !r.sha256) continue;
    const key = `${r.site} ${r.sha256}`;
    bySiteAndBytes.set(key, [...(bySiteAndBytes.get(key) ?? []), r]);
  }
  for (const list of bySiteAndBytes.values()) {
    if (new Set(list.map((r) => r.page)).size < 2) continue;
    for (const r of list) if (!isFrontPage(r.page)) r.general = true;
  }
  return rows;
}

// ── BESIDE THE REPORT, NEVER IN ITS WAY ─────────────────────────────────────────────────────────────────────────────
//
// The step can start while the report is still being written, from the cards as they stand then, and run beside it
// (startPictureStep). At publication the report takes only the pictures already fetched and shrunk whose page is still
// on a final card, and goes on at once (freezePictures): it waits for no request and no worker. What arrives later is
// dropped, and a delivered report is never published again to add one. The step keeps everything in memory until then,
// so a resume in a new process finds no step and records that it ran none.

/**
 * Start the picture step beside other work, from the cards as they stand now (`cards`: each card's pages). Returns at
 * once with a handle whose `rows` fill in as pages and pictures finish; `stop()` ends the step; `done` resolves when it
 * has ended, and never rejects. Nothing is written until freezePictures.
 */
export function startPictureStep({ cards, seconds = CLEARANCE_PICTURE_SECONDS, concurrency = PICTURE_CONCURRENCY, compareFrontPages = true, repeatedOnSite = false, now = () => performance.now(), ...seams }) {
  const stopper = new AbortController();
  const handle = { rows: [], startedAt: new Date().toISOString(), t0: now(), seconds, concurrency, compareFrontPages, repeatedOnSite, endedMs: null, result: null,
    stop: () => stopper.abort() };
  const pages = [...new Set([...(cards ?? new Map()).values()].flat())];
  handle.done = fetchPagePictures(pages, { seconds, concurrency, compareFrontPages, repeatedOnSite, now, signal: stopper.signal, onRows: (rows) => { handle.rows = rows; }, ...seams })
    .then((result) => { handle.result = result; handle.endedMs = Math.round(now() - handle.t0); }, () => { handle.endedMs = Math.round(now() - handle.t0); });
  return handle;
}

/**
 * At publication: stop the step and save, from what it has finished, each picture whose page is on a final card
 * (`finalCards`, from the findings as published). A picture counts only when it has arrived and been shrunk, and is
 * not a site's general card or awaiting its comparison; one whose page left the cards is dropped as stale, and a final
 * card's page the step never asked about shows nothing. Waits for nothing. Writes the record once: when the run already
 * has one, that record stands and nothing is written. With no step in this process, the record says so and holds no
 * picture. Returns `{ record, counts, written }`.
 */
export function freezePictures(runDir, handle, finalCards, { now = () => performance.now() } = {}) {
  const t0 = now();
  try {
    const existing = JSON.parse(readFileSync(driverDir(runDir, PICTURES_FILE), "utf8"));
    return { record: existing, counts: existing.counts ?? null, written: false };
  } catch { /* no record yet: this is the publication that takes the pictures */ }
  const cards = finalCards ?? new Map();
  const finalPages = new Set([...cards.values()].flat());
  if (!handle) {
    const record = writePictureRecord(runDir, { cards, result: { rows: [], ms: null, aborted: false }, seconds: null, concurrency: null,
      extra: { notRun: "the picture step did not run in this process", counts: { eligibleCards: cards.size, cardsWithPicture: 0 } } });
    return { record, counts: record.counts, written: true };
  }
  const endedBefore = handle.endedMs !== null;
  handle.stop();
  const atMs = Math.round(now() - handle.t0);
  // A copy of each row as it stands: what finishes after this line changes nothing here.
  const snap = handle.rows.map((r) => ({ ...r }));
  if (handle.compareFrontPages) frontPageRule(snap);
  if (handle.repeatedOnSite) repeatedPreviewRule(snap);
  let stale = 0, unfinished = 0;
  for (const r of snap) {
    if (r.forComparison) { r.data = null; continue; }
    if (!finalPages.has(r.page)) { if (r.state === "fetched") stale++; r.stale = true; r.data = null; continue; }
    if (r.state === "fetched" && !r.stored && !r.notStored) { r.notStored = "not shrunk by publication"; r.data = null; unfinished++; }
    if (r.state === "not-arrived") unfinished++;
    if (r.general || r.comparison) r.data = null;
  }
  const asked = new Set(snap.map((r) => r.page));
  const never = [...finalPages].filter((p) => !asked.has(p));
  for (const page of never) snap.push({ page, site: siteOf(page), state: "not-tried", addedAfterStart: true, picture: null, contentType: null, bytes: 0, sha256: null, ms: null, data: null });
  const record = writePictureRecord(runDir, { cards, result: { rows: snap, ms: atMs, aborted: !endedBefore, ...(Number.isFinite(handle.result?.shrinkMs) ? { shrinkMs: handle.result.shrinkMs } : {}) },
    seconds: handle.seconds, concurrency: handle.concurrency, extra: { startedAt: handle.startedAt } });
  const drawn = webPicturesForReport(runDir);
  const counts = { eligibleCards: cards.size, cardsWithPicture: drawn.size, picturesTaken: [...drawn.values()].reduce((a, l) => a + l.length, 0),
    stalePictures: stale, unfinishedAtPublication: unfinished, finalPagesNeverAsked: never.length, stepEndedBeforePublication: endedBefore,
    stepMsAtPublication: atMs, freezeMs: Math.round(now() - t0) };
  record.counts = counts;
  writeFileSync(driverDir(runDir, PICTURES_FILE), JSON.stringify(record, null, 2) + "\n");
  return { record, counts, written: true };
}

// ── THE RECORD, AND WHAT THE REPORT DRAWS FROM IT ───────────────────────────────────────────────────────────────────
//
// The run's picture record (PICTURES_FILE) says what happened to every page, beside the logo step's record, and the
// pictures that arrived are saved in its folder (PICTURES_DIR), each brought down to its box and named by the bytes the
// site served. A resume, a replay and a republish read it and fetch nothing again. A row the rule for a site's general
// card drops (`general: true`), one whose comparison was unfinished, and a front page fetched only to compare are never drawn.
export const PICTURES_FILE = "web-pictures.json";
export const PICTURES_DIR = "web-pictures";
const EXT = { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp" };

/**
 * Save the step's outcome with the run: the pictures that arrived, and a row for every page. Returns the record.
 * @param {string} runDir
 * @param {{ cards: Map<number, string[]>, result: { rows: object[], ms: number, aborted: boolean }, seconds: number, concurrency: number, takenAt?: string, general?: Set<string> }} step
 */
export function writePictureRecord(runDir, { cards, result, seconds, concurrency, takenAt = new Date().toISOString(), general = new Set(), extra = {} }) {
  const dir = ensureDriverDir(runDir, PICTURES_DIR);
  const byPage = new Map();
  for (const [ordinal, pages] of cards) for (const p of pages) byPage.set(p, [...(byPage.get(p) ?? []), ordinal]);
  const rows = result.rows.map(({ data, ...row }) => {
    const out = { ...row, cards: byPage.get(row.page) ?? [] };
    const type = row.stored?.contentType ?? row.contentType;   // what is saved: the picture brought down to its box, where it was
    if (row.state === "fetched" && data && EXT[type]) {
      const name = `${row.sha256.slice(0, 24)}.${EXT[type]}`;   // named by the bytes the site served
      writeFileSync(join(dir, name), data);
      out.file = `${DRIVER_DIR}/${PICTURES_DIR}/${name}`;   // relative to the run folder, the same on every system
    }
    if (row.general || (row.sha256 && general.has(row.sha256))) out.general = true;
    return out;
  });
  const record = { schema: 1, takenAt, seconds, concurrency, ms: result.ms, aborted: result.aborted, ...(Number.isFinite(result.shrinkMs) ? { shrinkMs: result.shrinkMs } : {}),
    ...extra, cards: Object.fromEntries([...cards].map(([ordinal, pages]) => [String(ordinal), pages])), rows };
  writeFileSync(driverDir(runDir, PICTURES_FILE), JSON.stringify(record, null, 2) + "\n");
  return record;
}

/**
 * What each card draws, by its key in the record (a clearance finding's ordinal, a Knockout card's id): its pages' pictures in the card's order, each once (by its bytes), at
 * most 8, as `{ page, site, src, fetchedOn }`. Empty for a run with no record. Only a saved file inside the run's picture
 * folder that still opens as the type recorded is drawn. PURE but for reading the run folder.
 */
export function webPicturesForReport(runDir) {
  const out = new Map();
  if (!runDir) return out;
  let doc = null;
  try { doc = JSON.parse(readFileSync(driverDir(runDir, PICTURES_FILE), "utf8")); } catch { return out; }
  const folder = resolve(driverDir(runDir, PICTURES_DIR)) + sep;
  const fetchedOn = String(doc?.takenAt ?? "").slice(0, 10);
  const src = new Map();
  for (const row of Array.isArray(doc?.rows) ? doc.rows : []) {
    const type = row?.stored?.contentType ?? row?.contentType;
    if (row?.state !== "fetched" || row.general === true || row.comparison || row.forComparison || typeof row.file !== "string" || !EXT[type]) continue;
    const at = resolve(runDir, row.file);
    if (!at.startsWith(folder)) continue;
    try {
      const bytes = readFileSync(at);
      if (imageTypeOf(bytes)?.type !== type) continue;
      src.set(row.page, { page: row.page, site: siteOf(row.page), sha256: row.sha256, src: `data:${type};base64,${bytes.toString("base64")}`, fetchedOn });
    } catch { /* a picture that cannot be read is not shown */ }
  }
  // Each card in its own order, the use check's pages first and the page it was found on last; a picture two of its
  // pages share shows once, with the first of those pages.
  for (const [ordinal, pages] of Object.entries(doc?.cards ?? {})) {
    const list = [];
    for (const page of Array.isArray(pages) ? pages : []) {
      const pic = src.get(page);
      if (pic && !list.some((p) => p.sha256 === pic.sha256)) list.push(pic);
    }
    if (list.length) out.set(String(ordinal), list.slice(0, 8));
  }
  return out;
}
