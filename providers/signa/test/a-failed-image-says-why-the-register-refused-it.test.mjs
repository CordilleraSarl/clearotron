// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// A FAILED LOGO IMAGE SAYS WHY THE REGISTER REFUSED IT. Measured on 2026-11-25: two logo images answered 503 and the run
// kept only "HTTP 503", so nothing said which backend failed or whether asking again would help. The logo row's cause now
// carries the register's own error type and detail, and whether it called itself retryable. No request is added.
import { test } from "node:test";
import assert from "node:assert/strict";
import { doMarkImage, imageFailureCause } from "../src/core.js";

test("the cause carries the register's error type, detail and retryable flag, and a plain status where the body is not its JSON", () => {
  assert.equal(imageFailureCause(503, Buffer.from(JSON.stringify({ type: "service_unavailable", detail: "A backend service is temporarily down or overloaded", retryable: true }))),
    "HTTP 503: service_unavailable — A backend service is temporarily down or overloaded — retryable");
  assert.equal(imageFailureCause(404, Buffer.from(JSON.stringify({ error: { type: "not_found", detail: "No such media", retryable: false } }))),
    "HTTP 404: not_found — No such media — not retryable");
  assert.equal(imageFailureCause(503, Buffer.from("<html>busy</html>")), "HTTP 503");
  assert.equal(imageFailureCause(500, null), "HTTP 500");
});

test("a 503 image keeps its cause and is asked once", async () => {
  const real = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; return new Response(JSON.stringify({ type: "service_unavailable", detail: "Down", retryable: true }), { status: 503 }); };
  try {
    const r = await doMarkImage("https://api.signa.example", "https://api.signa.example/media/1.png", null);
    assert.equal(r.ok, false);
    assert.equal(r.cause, "HTTP 503: service_unavailable — Down — retryable");
    assert.equal(calls, 1, "the image was asked again; a retry needs the owner's word on its count first");
  } finally { globalThis.fetch = real; }
});
