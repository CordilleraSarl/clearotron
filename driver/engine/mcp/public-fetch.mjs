// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// engine/mcp/public-fetch.mjs — fetch a PUBLIC web page, and refuse every address that is not one.
//
// The Codex engine's fetch tool reads pages the model names, and the model names pages a search turned up.
// A page can carry instructions, so the tool is the likeliest way to steer a stage at this machine's own
// network: loopback, the private ranges, link-local, and the cloud metadata addresses that hand out the
// machine's credentials. So the tool refuses them, and it refuses by the ADDRESS, never by the URL's text:
// a public-looking name can resolve to 127.0.0.1, and `0x7f000001` is loopback spelled as a number.
//
// WHERE THE CHECK SITS, and why there. The address is checked inside the connection's own name lookup, so
// the address checked is the address connected to: a name that resolves to a public address when checked
// and to 169.254.169.254 a moment later (DNS rebinding) never gets a second, unchecked lookup. A literal
// IP address skips name lookup altogether, so it is checked before the connection is opened. Redirects are
// followed here, one hop at a time, and every hop goes through both checks again.
//
// A name that resolves to several addresses is refused if ANY of them is internal, because the connection
// may use any of them.
import { lookup as dnsLookup } from "node:dns";
import { isIP, BlockList } from "node:net";
import http from "node:http";
import https from "node:https";
import zlib from "node:zlib";

// ── WHAT IS REFUSED ──────────────────────────────────────────────────────────────────────────────────
// Every range that is not the public internet, by the name a reader of the refusal needs.
const V4_RANGES = [
  ["0.0.0.0", 8, "unspecified"],
  ["10.0.0.0", 8, "private"],
  ["100.64.0.0", 10, "shared carrier"],        // carrier NAT; also where one cloud serves its metadata
  ["127.0.0.0", 8, "loopback"],
  ["169.254.0.0", 16, "link-local"],           // 169.254.169.254 is the metadata address of most clouds
  ["172.16.0.0", 12, "private"],
  ["192.0.0.0", 24, "reserved"],
  ["192.0.2.0", 24, "reserved"],
  ["192.168.0.0", 16, "private"],
  ["198.18.0.0", 15, "reserved"],
  ["198.51.100.0", 24, "reserved"],
  ["203.0.113.0", 24, "reserved"],
  ["224.0.0.0", 4, "multicast"],
  ["240.0.0.0", 4, "reserved"],                // includes 255.255.255.255
];
const V6_RANGES = [
  ["::", 128, "unspecified"],
  ["::1", 128, "loopback"],
  ["100::", 64, "reserved"],
  ["2001::", 32, "reserved"],                  // Teredo, which tunnels to an address it hides
  ["2001:db8::", 32, "reserved"],
  ["fc00::", 7, "private"],                    // unique local; fd00:ec2::254 is one cloud's metadata
  ["fe80::", 10, "link-local"],
  ["fec0::", 10, "private"],                   // the retired site-local range
  ["ff00::", 8, "multicast"],
];
const RANGES = new Map();   // one BlockList per reason, so a refusal can say which kind of address it was
for (const [net, prefix, why] of V4_RANGES) { if (!RANGES.has(why)) RANGES.set(why, new BlockList()); RANGES.get(why).addSubnet(net, prefix, "ipv4"); }
for (const [net, prefix, why] of V6_RANGES) { if (!RANGES.has(why)) RANGES.set(why, new BlockList()); RANGES.get(why).addSubnet(net, prefix, "ipv6"); }

/**
 * An IPv4 address carried inside an IPv6 one, which reaches the IPv4 host: IPv4-mapped (`::ffff:a.b.c.d`),
 * the old IPv4-compatible form (`::a.b.c.d`), NAT64 (`64:ff9b::/96`) and 6to4 (`2002:wwxx:yyzz::/48`).
 * null for any other IPv6 address. PURE.
 */
export function embeddedV4(v6) {
  const words = expandV6(v6);
  if (!words) return null;
  const v4 = (hi, lo) => `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
  const zeros = (from, to) => words.slice(from, to).every((w) => w === 0);
  if (zeros(0, 5) && words[5] === 0xffff) return v4(words[6], words[7]);                            // ::ffff:a.b.c.d
  if (zeros(0, 6) && (words[6] !== 0 || words[7] > 1)) return v4(words[6], words[7]);              // ::a.b.c.d
  if (words[0] === 0x64 && words[1] === 0xff9b && zeros(2, 6)) return v4(words[6], words[7]);      // 64:ff9b::a.b.c.d
  if (words[0] === 0x2002) return v4(words[1], words[2]);                                          // 2002:wwxx:yyzz::
  return null;
}

/** The eight 16-bit words of an IPv6 address, or null. Accepts `::` and a trailing dotted quad. PURE. */
function expandV6(addr) {
  let s = String(addr).toLowerCase().replace(/^\[|\]$/g, "").replace(/%.*$/, "");
  const quad = /(\d+\.\d+\.\d+\.\d+)$/.exec(s);
  if (quad) {
    const p = quad[1].split(".").map(Number);
    if (p.some((n) => n > 255)) return null;
    s = s.slice(0, -quad[1].length) + `${((p[0] << 8) | p[1]).toString(16)}:${((p[2] << 8) | p[3]).toString(16)}`;
  }
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const part = (h) => (h ? h.split(":").map((w) => parseInt(w, 16)) : []);
  const head = part(halves[0]), tail = halves.length === 2 ? part(halves[1]) : [];
  const fill = halves.length === 2 ? 8 - head.length - tail.length : 0;
  const words = [...head, ...Array(Math.max(0, fill)).fill(0), ...tail];
  return words.length === 8 && words.every((w) => Number.isInteger(w) && w >= 0 && w <= 0xffff) ? words : null;
}

/**
 * Is this address on the public internet? `{ ok: true }`, or `{ ok: false, kind }` naming the kind of
 * address it is (loopback, private, link-local…). Anything that is not an IP address is not public. PURE.
 */
export function isPublicAddress(address) {
  const a = String(address ?? "").replace(/^\[|\]$/g, "").replace(/%.*$/, "");
  const family = isIP(a);
  if (!family) return { ok: false, kind: "not an address" };
  const type = family === 4 ? "ipv4" : "ipv6";
  for (const [kind, list] of RANGES) if (list.check(a, type)) return { ok: false, kind };
  if (family === 6) {
    const inner = embeddedV4(a);
    if (inner) { const v = isPublicAddress(inner); if (!v.ok) return v; }
  }
  return { ok: true };
}

/** A refusal the connection raises, so it reaches the caller as its own kind of failure. */
class Refused extends Error {
  constructor(host, address, kind) {
    super(address && address !== host ? `${host} resolves to ${address}, a ${kind} address` : `${host} is a ${kind} address`);
    this.refused = true;
  }
}

/**
 * The name lookup the connection uses, with the check inside it. Honours both shapes Node asks for: one
 * address, or every address when `options.all` is set (Node's family auto-selection asks for all).
 */
export function checkedLookup({ lookup = dnsLookup, allow = isPublicAddress } = {}) {
  return (hostname, options, callback) => {
    const opts = typeof options === "object" && options ? options : { family: options };
    lookup(hostname, { ...opts, all: true }, (err, addresses) => {
      if (err) return callback(err);
      const list = Array.isArray(addresses) ? addresses : [{ address: addresses, family: isIP(addresses) }];
      if (!list.length) return callback(Object.assign(new Error(`${hostname} did not resolve`), { code: "ENOTFOUND" }));
      for (const a of list) {
        const v = allow(a.address);
        if (!v.ok) return callback(new Refused(hostname, a.address, v.kind));
      }
      if (opts.all) return callback(null, list);
      return callback(null, list[0].address, list[0].family);
    });
  };
}

const REDIRECTS = new Set([301, 302, 303, 307, 308]);
const DECODERS = { gzip: () => zlib.createGunzip(), "x-gzip": () => zlib.createGunzip(), deflate: () => zlib.createInflate(), br: () => zlib.createBrotliDecompress() };

/** One request, no redirect followed. Resolves `{ status, statusText, location, text }`. */
function requestOnce(url, { lookup, timeoutMs, maxBytes, userAgent }) {
  return new Promise((resolve, reject) => {
    const lib = url.protocol === "https:" ? https : http;
    const req = lib.request(url, {
      method: "GET", lookup, agent: false,
      headers: { "user-agent": userAgent, "accept-encoding": "gzip, deflate, br", accept: "*/*" },
    }, (res) => {
      const location = res.headers.location ?? null;
      if (REDIRECTS.has(res.statusCode) && location) { res.resume(); return resolve({ status: res.statusCode, statusText: res.statusMessage, location, text: "" }); }
      const enc = String(res.headers["content-encoding"] ?? "").trim().toLowerCase();
      const stream = DECODERS[enc] ? res.pipe(DECODERS[enc]()) : res;
      const chunks = []; let bytes = 0, clipped = false;
      stream.on("data", (c) => {
        if (clipped) return;
        chunks.push(c); bytes += c.length;
        if (bytes >= maxBytes) { clipped = true; req.destroy(); resolve({ status: res.statusCode, statusText: res.statusMessage, location: null, text: Buffer.concat(chunks).toString("utf8") }); }
      });
      stream.on("end", () => { if (!clipped) resolve({ status: res.statusCode, statusText: res.statusMessage, location: null, text: Buffer.concat(chunks).toString("utf8") }); });
      stream.on("error", (e) => { if (!clipped) reject(e); });
    });
    // The whole request, not an idle gap: a page that drips one byte a second would never trip an idle timer.
    const deadline = setTimeout(() => req.destroy(new Error(`no answer within ${Math.round(timeoutMs / 1000)}s`)), timeoutMs);
    req.on("close", () => clearTimeout(deadline));
    req.on("error", reject);
    req.end();
  });
}

/**
 * GET a public http(s) URL, following at most `maxRedirects` redirects, each one checked again.
 * Resolves `{ ok, status, statusText, url, text }` for an answer, or `{ refused }` naming why the tool will
 * not fetch it; rejects on a network failure. `lookup` and `allow` are seams for tests only.
 */
export async function fetchPublic(rawUrl, { maxRedirects = 5, timeoutMs = 30000, maxBytes = 5 * 1024 * 1024,
  userAgent = "cordillera-clearotron-fetch/0.1", lookup = dnsLookup, allow = isPublicAddress } = {}) {
  let url;
  try { url = new URL(String(rawUrl)); } catch { return { refused: `${rawUrl} is not a URL` }; }
  const connectLookup = checkedLookup({ lookup, allow });
  for (let hop = 0; ; hop++) {
    if (url.protocol !== "http:" && url.protocol !== "https:") return { refused: `${url.href} is not an http(s) address` };
    const host = url.hostname.replace(/^\[|\]$/g, "");
    if (isIP(host)) {   // a literal address skips name lookup, so it is checked here
      const v = allow(host);
      if (!v.ok) return { refused: `${host} is a ${v.kind} address` };
    }
    let r;
    try { r = await requestOnce(url, { lookup: connectLookup, timeoutMs, maxBytes, userAgent }); }
    catch (e) { if (e?.refused) return { refused: e.message }; throw e; }
    if (!r.location) return { ok: r.status >= 200 && r.status < 300, status: r.status, statusText: r.statusText, url: url.href, text: r.text };
    if (hop >= maxRedirects) return { refused: `${rawUrl} redirected more than ${maxRedirects} times` };
    try { url = new URL(r.location, url); } catch { return { refused: `${url.href} redirected to something that is not a URL` }; }
  }
}
