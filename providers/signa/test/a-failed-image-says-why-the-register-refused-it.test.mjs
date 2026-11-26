// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// A FAILED LOGO IMAGE SAYS WHY THE REGISTER REFUSED IT. Measured on 2026-11-25: two logo images answered 503 and the run
// kept only "HTTP 503", so nothing said which backend failed or whether asking again would help. The logo row's cause now
// carries the register's own error type and detail, and whether it called itself retryable.
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

// ASKED ONCE MORE, AT MOST (owner, 2026-11-26: at most one extra image request per failed logo), and only where the
// register says the failure is retryable, or a server error has no body to read.
const answering = (list) => { const calls = []; globalThis.fetch = async () => { const [status, body] = list[Math.min(calls.length, list.length - 1)]; calls.push(status); return new Response(body, { status, headers: status === 200 ? { "content-type": "image/png" } : {} }); }; return calls; };
const ask = () => doMarkImage("https://api.signa.example", "https://api.signa.example/media/1.png", null, { sleep: async () => {} });
const err = (o) => JSON.stringify(o);

test("a retryable failure, or a server error with no body, is asked once more and no more", async () => {
  const real = globalThis.fetch;
  try {
    let calls = answering([[503, err({ type: "service_unavailable", detail: "Down", retryable: true })]]);
    let r = await ask();
    assert.deepEqual(calls, [503, 503], "a retryable failure was not asked again, or was asked more than once more");
    assert.equal(r.cause, "HTTP 503: service_unavailable — Down — retryable");
    calls = answering([[503, "<html>busy</html>"], [200, "PNGBYTES"]]);
    r = await ask();
    assert.deepEqual(calls, [503, 200]);
    assert.equal(r.ok, true, "the image that answered on the second request was not kept");
  } finally { globalThis.fetch = real; }
});

test("a failure the register calls final, or a client error, is asked once", async () => {
  const real = globalThis.fetch;
  try {
    let calls = answering([[503, err({ type: "service_unavailable", detail: "Down", retryable: false })]]);
    await ask();
    assert.deepEqual(calls, [503], "a failure marked not retryable was asked again");
    calls = answering([[404, "missing"]]);
    const r = await ask();
    assert.deepEqual(calls, [404], "a client error was asked again");
    assert.equal(r.cause, "HTTP 404");
  } finally { globalThis.fetch = real; }
});
