// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A release is announced only once a stranger can install it.
//
// Measured on 0.3.2-beta.10, 2026-09-18: the releases page named the version nine minutes before an
// unauthenticated npm client could fetch it, and the workflow reported success in between. The check that
// now stands between the publish and the release entry is driven here against a stub registry, one arm per
// way the registry can answer: at once, late, never, with the tag behind, and with different bytes.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { visible } from "../../scripts/release-visible-check.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CHECK = join(ROOT, "scripts", "release-visible-check.mjs");
const DIR = mkdtempSync(join(tmpdir(), "visible-"));
after(() => rmSync(DIR, { recursive: true, force: true }));

const BYTES = Buffer.from("the tarball this run published");
const LOCAL = join(DIR, "pkg.tgz");
writeFileSync(LOCAL, BYTES);
const sri = (b) => `sha512-${createHash("sha512").update(b).digest("base64")}`;

/**
 * A registry that serves nothing for the first `hiddenFor` looks, then the version; its tag moves only
 * after `tagLagsBy` more; and it serves `served` as the tarball. Counts the looks it was given.
 */
async function registry({ version = "9.9.9-beta.1", tag = "beta", hiddenFor = 0, tagLagsBy = 0, served = BYTES, integrity } = {}) {
  let looks = 0;
  const server = createServer((req, res) => {
    const url = new URL(req.url, "http://x");
    if (req.headers.authorization) { res.writeHead(400); return res.end("a credential was sent"); }
    if (url.pathname === `/clearotron/${version}`) {
      looks += 1;
      if (looks <= hiddenFor) { res.writeHead(404); return res.end("{}"); }
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({ version, dist: { tarball: `http://127.0.0.1:${server.address().port}/t.tgz`, integrity: integrity ?? sri(served) } }));
    }
    if (url.pathname === "/-/package/clearotron/dist-tags") {
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({ [tag]: looks > hiddenFor + tagLagsBy ? version : "9.9.9-beta.0" }));
    }
    if (url.pathname === "/t.tgz") { res.writeHead(200); return res.end(served); }
    res.writeHead(404); res.end();
  });
  await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
  return { url: `http://127.0.0.1:${server.address().port}`, looks: () => looks, close: () => new Promise((ok) => server.close(ok)) };
}

function run(reg, { version = "9.9.9-beta.1", tag = "beta", timeout = "3", interval = "0.2", tarball = LOCAL } = {}) {
  return new Promise((ok) => {
    const p = spawn(process.execPath, [CHECK, "--version", version, "--tag", tag, "--tarball", tarball,
      "--registry", reg.url, "--timeout", timeout, "--interval", interval], { stdio: ["ignore", "pipe", "pipe"] });
    let out = ""; p.stdout.on("data", (d) => { out += d; }); p.stderr.on("data", (d) => { out += d; });
    p.on("close", (code) => ok({ code, out }));
  });
}

test("a version the registry serves at once, under its tag, with the published bytes, passes", async () => {
  const reg = await registry();
  try {
    const r = await run(reg);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /the tarball served is the one this run published/);
  } finally { await reg.close(); }
});

test("a version that appears late is waited for, not refused", async () => {
  const reg = await registry({ hiddenFor: 3 });
  try {
    const r = await run(reg);
    assert.equal(r.code, 0, r.out);
    assert.ok(reg.looks() >= 4, `it passed after ${reg.looks()} look(s), so it cannot have waited for the fourth`);
    assert.match(r.out, /answers clearotron@9\.9\.9-beta\.1 → nothing/, "the looks that found nothing were not reported");
  } finally { await reg.close(); }
});

test("a version never served within the bound is refused, and says no entry is created", async () => {
  const reg = await registry({ hiddenFor: 1e9 });
  try {
    const r = await run(reg, { timeout: "1" });
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /no release entry is created/);
  } finally { await reg.close(); }
});

test("the version alone is not enough: a tag still naming the previous version is waited for", async () => {
  const reg = await registry({ tagLagsBy: 2 });
  try {
    const r = await run(reg);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /beta → 9\.9\.9-beta\.0/, "the look where the version was served and the tag was not is not reported");
  } finally { await reg.close(); }
});

test("a registry serving DIFFERENT BYTES under the published version is refused", async () => {
  const reg = await registry({ served: Buffer.from("not what this run built") });
  try {
    const r = await run(reg);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /DIFFERENT BYTES/);
  } finally { await reg.close(); }
});

test("a dry run expecting the wrong version fails, and never reports success", async () => {
  // The acceptance's own dry run: the registry serves 9.9.9-beta.1 and the check is told to expect a
  // version that was never published.
  const reg = await registry();
  try {
    const r = await run(reg, { version: "9.9.9-beta.2", timeout: "1" });
    assert.equal(r.code, 1, r.out);
    assert.doesNotMatch(r.out, /a stranger can install/);
  } finally { await reg.close(); }
});

test("missing arguments or an unreadable tarball are could-not-look, never a pass", async () => {
  const reg = await registry();
  try {
    assert.equal((await run(reg, { tarball: join(DIR, "absent.tgz") })).code, 2);
    assert.equal((await run(reg, { interval: "0" })).code, 2);
  } finally { await reg.close(); }
});

test("PURE: the version must be served AND tagged, and the document must name a tarball", () => {
  const v = { version: "1.0.0" };
  assert.equal(visible({ version: "1.0.0", tagged: "1.0.0", tarball: "x" }, v), true);
  assert.equal(visible({ version: "1.0.0", tagged: "0.9.0", tarball: "x" }, v), false);
  assert.equal(visible({ version: null, tagged: "1.0.0", tarball: "x" }, v), false);
  assert.equal(visible({ version: "1.0.0", tagged: "1.0.0", tarball: null }, v), false);
});
