// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// THE CODEX ENGINE'S FETCH TOOL REACHES PUBLIC ADDRESSES ONLY.
//
// A page a search reads can carry instructions, and the fetch tool is how a steered stage would reach this
// machine's own network: loopback, the private ranges, link-local, and the cloud metadata addresses. The
// tool now refuses those by the ADDRESS a name resolves to, on the first request and on every redirect.
//
// OFFLINE. Every server here listens on 127.0.0.1, which the real policy refuses, so no arm reaches the
// internet. Where an arm needs a server to play a public host, it hands `fetchPublic` a policy that allows
// 127.0.0.1 and refuses everything else the real policy refuses, and says so.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { gzipSync } from "node:zlib";

import { fetchPublic, isPublicAddress, embeddedV4, checkedLookup } from "../engine/mcp/public-fetch.mjs";

test("every internal kind of address is refused, and public ones pass", () => {
  const refused = {
    "127.0.0.1": "loopback", "127.8.9.10": "loopback", "::1": "loopback",
    "10.1.2.3": "private", "172.16.0.9": "private", "172.31.255.255": "private", "192.168.1.1": "private", "fd00:ec2::254": "private",
    "169.254.169.254": "link-local", "fe80::1": "link-local",
    "100.100.100.200": "shared carrier", "0.0.0.0": "unspecified", "::": "unspecified",
    "224.0.0.1": "multicast", "255.255.255.255": "reserved",
    // IPv4 carried in IPv6: mapped, NAT64 and 6to4 all reach the IPv4 host.
    "::ffff:127.0.0.1": "loopback", "::ffff:7f00:1": "loopback", "64:ff9b::a9fe:a9fe": "link-local", "2002:a9fe:a9fe::1": "link-local",
  };
  for (const [addr, kind] of Object.entries(refused))
    assert.deepEqual(isPublicAddress(addr), { ok: false, kind }, addr);
  for (const addr of ["1.1.1.1", "8.8.8.8", "93.184.215.14", "2606:4700:4700::1111", "::ffff:1.1.1.1"])
    assert.deepEqual(isPublicAddress(addr), { ok: true }, addr);
  assert.equal(isPublicAddress("example.com").ok, false, "a name is not an address, so it is never public by itself");
  assert.equal(embeddedV4("2606:4700:4700::1111"), null);
});

test("an internal address spelled another way in the URL is still refused, and nothing is fetched", async () => {
  for (const url of ["http://127.0.0.1/", "http://0x7f000001/", "http://2130706433/", "http://127.1/", "http://[::1]/",
    "http://[::ffff:127.0.0.1]/", "http://169.254.169.254/latest/meta-data/", "https://10.0.0.1/"]) {
    const r = await fetchPublic(url, { lookup: () => assert.fail(`a literal address was looked up: ${url}`) });
    assert.ok(r.refused, `${url} was not refused: ${JSON.stringify(r)}`);
  }
});

test("a public-looking name is refused by the address it resolves to, including one of several", async () => {
  const lookup = (map) => (host, opts, cb) => {
    const list = map[host];
    if (!list) return cb(Object.assign(new Error(`no such host ${host}`), { code: "ENOTFOUND" }));
    return cb(null, list.map((address) => ({ address, family: address.includes(":") ? 6 : 4 })));
  };
  const names = { "innocent.example": ["127.0.0.1"], "metadata.example": ["169.254.169.254"], "both.example": ["93.184.215.14", "10.0.0.7"] };
  for (const [host, [addr]] of Object.entries({ "innocent.example": ["127.0.0.1"], "metadata.example": ["169.254.169.254"] })) {
    const r = await fetchPublic(`http://${host}/`, { lookup: lookup(names) });
    assert.ok((r.refused ?? "").includes(`${host} resolves to ${addr}`), JSON.stringify(r));
  }
  const both = await fetchPublic("http://both.example/", { lookup: lookup(names) });
  assert.match(both.refused ?? "", /resolves to 10\.0\.0\.7, a private address/, "one internal address among several is enough");
});

test("the check sits in the connection's own lookup, in both shapes Node asks for", async () => {
  const inner = (host, opts, cb) => cb(null, [{ address: "8.8.8.8", family: 4 }, { address: "2001:4860:4860::8888", family: 6 }]);
  const lk = checkedLookup({ lookup: inner });
  const one = await new Promise((res) => lk("x.example", { family: 0 }, (err, address, family) => res({ err, address, family })));
  assert.deepEqual(one, { err: null, address: "8.8.8.8", family: 4 });
  const all = await new Promise((res) => lk("x.example", { all: true }, (err, list) => res({ err, list })));
  assert.equal(all.err, null);
  assert.equal(all.list.length, 2);
});

/** A local server that records every request it receives. */
async function server(handler) {
  const seen = [];
  const s = createServer((req, res) => { seen.push(req.url); handler(req, res); });
  await new Promise((r) => s.listen(0, "127.0.0.1", r));
  return { url: `http://127.0.0.1:${s.address().port}`, seen, close: () => new Promise((r) => s.close(r)) };
}

test("with the real policy a server on this machine is never reached", async () => {
  const s = await server((req, res) => res.end("the machine's own service"));
  try {
    const r = await fetchPublic(`${s.url}/admin`);
    assert.match(r.refused ?? "", /127\.0\.0\.1 is a loopback address/);
    assert.deepEqual(s.seen, [], "the refused request reached the server");
  } finally { await s.close(); }
});

// For the redirect arms a local server plays the public first hop: this policy lets 127.0.0.1 through and
// refuses everything else the real one refuses.
const localIsPublic = (a) => (String(a) === "127.0.0.1" ? { ok: true } : isPublicAddress(a));

test("a redirect is checked again, hop by hop: to a metadata address, to a name that resolves inward", async () => {
  const s = await server((req, res) => {
    if (req.url === "/to-metadata") { res.writeHead(302, { location: "http://169.254.169.254/latest/meta-data/iam/" }); return res.end(); }
    if (req.url === "/to-name") { res.writeHead(301, { location: "http://intranet.example/secret" }); return res.end(); }
    if (req.url === "/to-page") { res.writeHead(307, { location: "/page" }); return res.end(); }
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("a public page");
  });
  const lookup = (host, opts, cb) => (host === "intranet.example" ? cb(null, [{ address: "10.1.1.1", family: 4 }]) : cb(null, [{ address: "127.0.0.1", family: 4 }]));
  try {
    const meta = await fetchPublic(`${s.url}/to-metadata`, { allow: localIsPublic, lookup });
    assert.match(meta.refused ?? "", /169\.254\.169\.254 is a link-local address/);
    const name = await fetchPublic(`${s.url}/to-name`, { allow: localIsPublic, lookup });
    assert.match(name.refused ?? "", /intranet\.example resolves to 10\.1\.1\.1, a private address/);
    const page = await fetchPublic(`${s.url}/to-page`, { allow: localIsPublic, lookup });
    assert.equal(page.ok, true, JSON.stringify(page));
    assert.equal(page.text, "a public page");
    assert.deepEqual(s.seen, ["/to-metadata", "/to-name", "/to-page", "/page"], "only the allowed hops reached the server");
  } finally { await s.close(); }
});

test("a compressed page arrives as text, and a redirect loop stops", async () => {
  const s = await server((req, res) => {
    if (req.url === "/loop") { res.writeHead(302, { location: "/loop" }); return res.end(); }
    res.writeHead(200, { "content-type": "text/html", "content-encoding": "gzip" });
    res.end(gzipSync(Buffer.from("<p>EUR-Lex judgment text</p>")));
  });
  try {
    const page = await fetchPublic(`${s.url}/doc`, { allow: localIsPublic });
    assert.equal(page.text, "<p>EUR-Lex judgment text</p>");
    const loop = await fetchPublic(`${s.url}/loop`, { allow: localIsPublic, maxRedirects: 3 });
    assert.match(loop.refused ?? "", /redirected more than 3 times/);
  } finally { await s.close(); }
});
