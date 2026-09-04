// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// Dev-portal (docs/E2E.md Tier 1 UI): static pool serving + the /profiles/* reverse-proxy, offline.
// Uses node:http's client (NOT fetch — undici's WASM OOMs under constrained dev ulimits), in-process
// servers on ephemeral ports.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, get as httpGet, request as httpRequest } from "node:http";
import { startPortal } from "../dev-portal.mjs";

function req(port, path, { method = "GET", body = null } = {}) {
  return new Promise((resolve, reject) => {
    const r = httpRequest({ host: "127.0.0.1", port, path, method }, (res) => {
      let data = "";
      res.on("data", (c) => { data += c; });
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    });
    r.on("error", reject);
    if (body) r.write(body);
    r.end();
  });
}

test("dev-portal: serves the pool statically, guards traversal, proxies /profiles/*", async () => {
  // a miniature pool
  const pool = mkdtempSync(join(tmpdir(), "devportal-pool-"));
  writeFileSync(join(pool, "index.html"), "<h1>dev archive index</h1>");
  mkdirSync(join(pool, "run-1"), { recursive: true });
  writeFileSync(join(pool, "run-1", "report.html"), "<h1>report</h1>");
  writeFileSync(join(pool, "run-1", "findings.json"), "{\"ok\":true}");

  // a stub profile-service upstream (echoes path+method)
  const upstream = createServer((q, s) => { s.writeHead(200, { "content-type": "application/json" }); s.end(JSON.stringify({ path: q.url, method: q.method })); });
  await new Promise((r) => upstream.listen(0, "127.0.0.1", r));

  const portal = await startPortal({ poolRoot: pool, port: 0, profileTarget: { host: "127.0.0.1", port: upstream.address().port } });
  const port = portal.address().port;
  try {
    // PARITY: `/` is the pool archive index, same as the prod host (the dev portal mirrors prod)
    const idx = await req(port, "/");
    assert.equal(idx.status, 200);
    assert.match(idx.body, /dev archive index/);
    const rep = await req(port, "/run-1/report.html");
    assert.equal(rep.status, 200);
    assert.match(rep.headers["content-type"], /text\/html/);
    const js = await req(port, "/run-1/findings.json");
    assert.match(js.headers["content-type"], /application\/json/);
    // directory path → its index.html; missing → 404
    assert.equal((await req(port, "/run-1")).status, 404, "run-1 has no index.html → honest 404");
    assert.equal((await req(port, "/nope.html")).status, 404);
    // traversal is refused (encoded and plain)
    for (const p of ["/../dev-portal.test.mjs", "/%2e%2e/%2e%2e/etc/passwd"]) {
      const r = await req(port, p);
      assert.ok([400, 404].includes(r.status), `${p} must never escape the pool (got ${r.status})`);
    }
    // the profile editor UI is served from driver/ without a pool deploy
    const page = await req(port, "/profiles.html");
    assert.equal(page.status, 200);
    assert.match(page.body, /profiles/i);
    // /profiles/* proxies through, method + path intact
    const health = await req(port, "/profiles/health");
    assert.deepEqual(JSON.parse(health.body), { path: "/profiles/health", method: "GET" });
    const post = await req(port, "/profiles/aurora/save", { method: "POST", body: "{}" });
    assert.equal(JSON.parse(post.body).method, "POST");
  } finally {
    portal.close();
    upstream.close();
  }
});

test("dev-portal: refuses non-loopback hosts (dev tool, never an ingress) + 502s a dead upstream", async () => {
  assert.throws(() => startPortal({ host: "0.0.0.0" }), /loopback-only/); // refuses BEFORE binding anything

  const pool = mkdtempSync(join(tmpdir(), "devportal-pool-"));
  const portal = await startPortal({ poolRoot: pool, port: 0, profileTarget: { host: "127.0.0.1", port: 1 } });
  try {
    const r = await req(portal.address().port, "/profiles/health");
    assert.equal(r.status, 502);
    assert.match(JSON.parse(r.body).error, /profile-service not reachable/);
  } finally {
    portal.close();
  }
});

test("dev cockpit: enqueue validates-first into the dev queue; runs + outbox endpoints read the dev data plane", async () => {
  const base = mkdtempSync(join(tmpdir(), "devportal-cockpit-"));
  const pool = join(base, "pool"); mkdirSync(pool);
  const queue = join(base, "queue");
  const outbox = join(base, "outbox"); mkdirSync(outbox, { recursive: true });
  const ws = join(base, "ws");
  // one live run's status.json in a workspace the scanner recognises
  const runDir = join(ws, "workspace-dev", "studio", "prelim-search", "tmp1-demomark", "2026-01-01-mock-run");
  mkdirSync(runDir, { recursive: true });
  writeFileSync(join(runDir, "status.json"), JSON.stringify({
    runId: "tmp1-demomark-mock-run", slug: "tmp1-demomark", codename: "mock-run", agent: "dev",
    state: "running", stepN: 3, stepLabel: "Register sweep", stepTotal: 9, markName: "DemoMark",
    updatedAt: "2026-01-01T10:00:00Z" }));
  // one JSON packet + one legacy marker in the outbox
  writeFileSync(join(outbox, "tmp1-demomark-mock-run.failed.pending"), JSON.stringify({ kind: "run-failed", runId: "tmp1-demomark-mock-run", agent: "dev", text: "x" }));
  writeFileSync(join(outbox, "legacy-run.pending"), "dev\n");

  const portal = await startPortal({ poolRoot: pool, port: 0, queueDir: queue, workspaceRoot: ws, outboxDir: outbox,
    recipeTarget: { host: "127.0.0.1", port: 1 } });   // port 1 ⇒ deterministic connection-refused for the 502 assertion
  const port = portal.address().port;
  try {
    // the cockpit page serves
    const page = await req(port, "/dev");
    assert.equal(page.status, 200);
    assert.match(page.body, /dev cockpit/);

    // ── THE FORM MUST NOT POST A TOGGLE IT IS NOT OFFERING ──────────────────────────────────────────
    //
    // The enqueue form's submit handler used to write `b.nativeLanguage = fd.get("nativeLanguage") != null`,
    // so an UNTICKED box posted `false` on every submit. That was harmless only because the door dropped
    // it. Now that `false` is refused — it switches nothing off, so accepting it would record a promise
    // nothing keeps — an unconditional assignment would 422 every enqueue from this form.
    //
    // Asserted on the PAGE SOURCE because nothing else can be: the door tests below post JSON bodies
    // directly and never run this script, so a revert here breaks the cockpit silently and green.
    assert.doesNotMatch(page.body, /b\.nativeLanguage\s*=\s*fd\.get/,
      "the form assigns nativeLanguage unconditionally again — an unticked box will post false and 422");
    assert.match(page.body, /if\(fd\.get\("nativeLanguage"\)!=null\)b\.nativeLanguage=true;else delete b\.nativeLanguage;/,
      "the toggle must travel ONLY when ticked — the offering has no `off` to send");

    // valid enqueue → job lands atomically in the dev queue, same shape as the CLI door
    const ok = await req(port, "/dev/enqueue", { method: "POST",
      body: JSON.stringify({ mark: "DemoMark", classes: "9,42", forwarder: "dev", profile: "aurora" }) });
    assert.equal(ok.status, 200, ok.body);
    const okBody = JSON.parse(ok.body);
    assert.equal(okBody.ok, true);
    const jobFile = join(queue, `${okBody.id}.json`);
    assert.ok(existsSync(jobFile), "job file written to the dev queue");
    const job = JSON.parse(readFileSync(jobFile, "utf8"));
    assert.equal(job.markName, "DemoMark");
    assert.deepEqual(job.classes, [9, 42]);
    assert.equal(job.profileKey, "aurora");
    assert.equal(job.enqueuedVia, "cli/enqueue");

    // invalid (no classes/goods) → 422 with the validator's classify, nothing written
    const bad = await req(port, "/dev/enqueue", { method: "POST",
      body: JSON.stringify({ mark: "NoScope", forwarder: "dev" }) });
    assert.equal(bad.status, 422);
    assert.equal(JSON.parse(bad.body).ok, false);
    // missing forwarder → clarify
    const noFwd = await req(port, "/dev/enqueue", { method: "POST", body: JSON.stringify({ mark: "X", classes: "9" }) });
    assert.equal(noFwd.status, 422);
    assert.match(JSON.parse(noFwd.body).errors.join(" "), /forwarder/);

    // runs endpoint sees the workspace status.json
    const runs = JSON.parse((await req(port, "/dev/runs")).body);
    assert.equal(runs.length, 1);
    assert.equal(runs[0].markName, "DemoMark");
    assert.equal(runs[0].state, "running");

    // outbox endpoint parses packets AND legacy markers
    const ob = JSON.parse((await req(port, "/dev/outbox")).body);
    assert.equal(ob.length, 2);
    const kinds = ob.map((e) => e.packet?.kind ?? (e.legacyAgent ? "legacy" : "?")).sort();
    assert.deepEqual(kinds, ["legacy", "run-failed"]);

    // recipeKey rides the same intake contract (both selectors set = the honest clarify)
    const both = await req(port, "/dev/enqueue", { method: "POST",
      body: JSON.stringify({ mark: "X", classes: "9", forwarder: "dev", product: "knockout-search", recipeKey: "quarterly-screen" }) });
    assert.equal(both.status, 422);
    assert.match(JSON.parse(both.body).errors.join(" "), /names no saved search/);

    // /recipes/* proxies to the recipe-service; with none running the answer is an honest 502
    const prox = await req(port, "/recipes");
    assert.equal(prox.status, 502);
    assert.match(JSON.parse(prox.body).error, /recipe-service not reachable/);

    // the cockpit page carries the Searches panel + the recipe field
    const cockpit = (await req(port, "/dev")).body;
    assert.match(cockpit, /Searches \(saved \+ built-in\)/);
    assert.match(cockpit, /Compose a saved search/);
    assert.match(cockpit, /recipeKey/);
  } finally {
    portal.close();
  }
});

test("dev-portal: /recipes/* proxy forwards method+path+query+body to the upstream (review 2026-07-18 — the 502 test alone was pass-through-blind)", async () => {
  const pool = mkdtempSync(join(tmpdir(), "devportal-recproxy-"));
  writeFileSync(join(pool, "index.html"), "x");
  const seen = [];
  const upstream = createServer((q, s) => {
    let body = "";
    q.on("data", (c) => { body += c; });
    q.on("end", () => { seen.push({ method: q.method, url: q.url, body }); s.writeHead(201, { "content-type": "application/json" }); s.end(JSON.stringify({ echoed: true })); });
  });
  await new Promise((r) => upstream.listen(0, "127.0.0.1", r));
  const portal = await startPortal({ poolRoot: pool, port: 0, recipeTarget: { host: "127.0.0.1", port: upstream.address().port } });
  const port = portal.address().port;
  try {
    const r = await req(port, "/recipes/acme/screen/validate?x=1", { method: "POST", body: JSON.stringify({ recipe: { label: "L", base: "global-preliminary-search" } }) });
    assert.equal(r.status, 201, "upstream status passes through");
    assert.equal(seen.length, 1);
    assert.equal(seen[0].method, "POST");
    assert.equal(seen[0].url, "/recipes/acme/screen/validate?x=1", "path + query forwarded verbatim");
    assert.match(seen[0].body, /"label":"L"/, "the request body streams through");
  } finally { portal.close(); upstream.close(); }
});
