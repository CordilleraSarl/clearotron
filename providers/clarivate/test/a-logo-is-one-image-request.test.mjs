// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A cited registration's logo is one live image request on the register's `/image` call, and what comes back is
// returned as bytes for the driver to check; a call that does not land, or holds no image, says so. The register is
// stood in for here: no request leaves the process, and every answer is invented.
import { test } from "node:test";
import assert from "node:assert/strict";
import { doMarkImage } from "../src/core.js";

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

async function ask(status, body) {
  const real = globalThis.fetch;
  const sent = [];
  globalThis.fetch = async (url, init) => {
    sent.push({ url: String(url), body: JSON.parse(init.body) });
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  };
  try { return { got: await doMarkImage("invented-key", "https://register.invalid", "/mark/em/0001", null), sent }; }
  finally { globalThis.fetch = real; }
}

test("one request for the live image, and its bytes come back", async () => {
  const { got, sent } = await ask(200, { images: [{ image: PNG.toString("base64"), contentType: "image/png" }] });
  assert.equal(sent.length, 1, "more than one request for one logo");
  assert.match(sent[0].url, /\/image$/);
  assert.equal(sent[0].body.test, undefined, "the logo for a report must be the live image, not the test one");
  assert.equal(got.ok, true);
  assert.deepEqual(got.bytes, PNG);
  assert.equal(got.contentType, "image/png");
});

test("a call that does not land, or holds no image, is not a logo", async () => {
  assert.equal((await ask(503, { message: "invented outage" })).got.ok, false);
  const empty = await ask(200, { images: [] });
  assert.equal(empty.got.ok, false);
  assert.match(empty.got.cause, /no image/);
  assert.equal((await ask(200, { unexpected: true })).got.ok, false);
});
