// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// health-carries-the-build.test.mjs —: which build is answering, readable without a grant.
//
// The duty "confirm the merge reached test" was being discharged by INFERENCE — merge ancestry plus
// the deploy timer's schedule — because no account outside the pool's group could read a run's
// meta.json and nothing served the commit. An inferred deploy confirmation is right until the timer
// skips a beat, and nothing about it says which of those two you are looking at.
//
// The acceptance criterion is a JOIN: /health must return the engineCommit that pool meta would record
// for a NEW round. So the assertion that matters is not "the field is a sha" — it is "the field is the
// SAME FUNCTION'S ANSWER as the one publish stamps". A second derivation that agreed today and drifted
// next month would satisfy a shape test and fail the criterion silently.
//
// Driven over a real loopback socket rather than by calling a handler: /portal/health is answered in
// makeHttpHandler BEFORE identity is resolved, and "no grant needed" is a property of that ordering,
// not of the response body. node:http rather than fetch, following portal-local-login.test.mjs —
// undici's WASM OOMs under constrained ulimits and this suite has to pass there.
//
// SAFETY GUARD: env pinned before dynamic driver imports (driver.config freezes roots at import).
import { mkdtempSync as __mkdtemp } from "node:fs";
import { tmpdir as __tmpdir } from "node:os";
import { join as __join } from "node:path";
import { pinEnv, envFrom } from "../../shared/env-aliases.mjs";   // — the default is taken only when NO spelling holds a value
pinEnv(process.env, "CLEAROTRON_WORK_DIR", envFrom(process.env, "CLEAROTRON_WORK_DIR") || __mkdtemp(__join(__tmpdir(), "portal-health-ws-")));
pinEnv(process.env, "CLEAROTRON_REPORTS_DIR", envFrom(process.env, "CLEAROTRON_REPORTS_DIR") || __mkdtemp(__join(__tmpdir(), "portal-health-pool-")));
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer, request as httpRequest } from "node:http";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const { makeHttpHandler, makePortalService, resetDoctrineStoreCache } = await import("../portal-service.mjs");
const { engineCommit } = await import("../engine-build.mjs");

async function withPortal(fn) {
  const service = makePortalService({
    poolRoot: mkdtempSync(join(tmpdir(), "portal-health-pool-")),
    workspaceRoot: mkdtempSync(join(tmpdir(), "portal-health-ws-")),
    secret: "health-test-secret", staffDomains: [], grants: {},
  });
  // devIdentity, not a real verifier: the point of these tests is the route answered BEFORE identity,
  // and a handler with no identity source at all refuses to exist.
  const srv = createServer(makeHttpHandler({
    verify: null, limiter: null, service, devIdentity: { email: "dev@local" }, log: () => {},
  }));
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  try { await fn(srv.address().port); }
  finally { await new Promise((r) => srv.close(r)); }
}

const get = (port, path) => new Promise((resolve, reject) => {
  const r = httpRequest({ host: "127.0.0.1", port, path, method: "GET" }, (res) => {
    let data = "";
    res.on("data", (c) => { data += c; });
    res.on("end", () => resolve({ status: res.statusCode, body: data }));
  });
  r.on("error", reject);
  r.end();
});

test("#1136 /portal/health carries the engineCommit — and it is the SAME function pool meta records", async () => {
  await withPortal(async (port) => {
    const res = await get(port, "/portal/health");
    assert.equal(res.status, 200);
    const body = JSON.parse(res.body);
    assert.ok("engineCommit" in body, "the field a deploy confirmation reads must exist even when null");
    assert.equal(body.engineCommit, engineCommit(),
      "the endpoint must answer with engine-build.mjs's own value, not a second derivation of it");
  });
});

test("#1136 the endpoint and the publisher import the same stamp, so they cannot drift apart", () => {
  // The join the acceptance criterion is really about, asserted at the source rather than by comparing
  // two runtime values that happen to agree today. A shape test would pass on a re-derived sha.
  const publisher = readFileSync(join(ROOT, "driver/publish/index.mjs"), "utf8");
  const portal = readFileSync(join(ROOT, "driver/portal-service.mjs"), "utf8");
  for (const [what, src] of [["the publisher", publisher], ["the portal", portal]]) {
    // widened the character class, not the subject. This guard is about the JOIN — that both
    // sites call engine-build's own function rather than re-deriving a sha — and added sibling
    // imports from the same module. Matching `engineCommit` inside a named-import list keeps the
    // property and stops the pin failing on an import that does not touch it. `\b` after the name is
    // load-bearing: it refuses to match `engineCommitDate`, so deleting the real import and leaving
    // the sibling behind still goes red.
    assert.match(src, /import \{[^}]*\bengineCommit\b[^}]*\} from ['"][^'"]*engine-build\.mjs['"]/,
      `${what} no longer imports engineCommit from engine-build.mjs — if either grows its own, /health `
      + `stops being a statement about the run that pool meta will record`);
  }
  assert.match(publisher, /engineCommit: engineCommit\(\)/, "and the publisher still stamps it into meta.json");
});

test("#1136 health answers BEFORE identity — any account can confirm a deploy with no grant", async () => {
  await withPortal(async (port) => {
    // The whole reason half 2 (a filesystem grant for the dev account) stops being urgent. If this
    // route ever moves behind the identity gate, the endpoint still returns 200 to a staff browser and
    // the person who needed it most gets a redirect.
    const health = await get(port, "/portal/health");
    assert.equal(health.status, 200);
    // The control: a route that IS behind identity must not answer 200 to the same anonymous caller,
    // or this test proves nothing about ordering.
    const scoped = await get(port, "/portal/api/runs");
    assert.notEqual(scoped.status, 200,
      "a scoped route answered an anonymous GET — then `health is pre-identity` is not what is being measured");
  });
});

test("#1136 the existing fields are untouched — a monitor reading ok/ui must not break", async () => {
  await withPortal(async (port) => {
    const body = JSON.parse((await get(port, "/portal/health")).body);
    assert.equal(body.ok, true);
    assert.ok(["built", "missing", "unwired"].includes(body.ui), `ui was ${JSON.stringify(body.ui)}`);
  });
});

test("#1136 the doctrine store is REPORTED, and it is re-read rather than frozen at boot", async () => {
  await withPortal(async (port) => {
    const body = JSON.parse((await get(port, "/portal/health")).body);
    assert.ok(body.store && typeof body.store === "object", "the store answer is an object, not a bare sha");
    assert.ok("head" in body.store, "null is a legal head; absent is not — a missing key reads as no store");
    assert.ok(typeof body.store.situation === "string" && body.store.situation,
      "a null head with no situation reads as `no store`, which is a healthy state and a different one");
    // `unreadable` is the arm the first draft of this shipped by accident: it referenced a `config`
    // binding that does not exist at module scope, the ReferenceError landed in the catch, and the
    // endpoint answered with a plausible wrong word. If it ever comes back, this says so.
    assert.notEqual(body.store.situation, "unreadable",
      `the store classifier threw: ${JSON.stringify(body.store)}`);
  });
});

test("#1136 the store answer has a bounded staleness — the engine's cache rule does not apply to it", async () => {
  // engine-build.mjs caches for the life of the process and says why: code cannot change under a
  // running process. Doctrine CAN — a config deploy re-renders the overlay in place while the portal
  // keeps running — so a store sha cached the same way would answer with what was there at boot.
  const src = readFileSync(join(ROOT, "driver/portal-service.mjs"), "utf8");
  const m = /const STORE_TTL_MS = ([\d_]+);/.exec(src);
  assert.ok(m, "the store answer has no declared TTL — then its staleness is unbounded and unstated");
  const ttl = Number(m[1].replace(/_/g, ""));
  assert.ok(ttl > 0 && ttl <= 60_000,
    `STORE_TTL_MS is ${ttl}ms — the bound on how wrong this field may be. Above a minute it stops being `
    + `a deploy confirmation and becomes a second thing to distrust.`);
  assert.equal(typeof resetDoctrineStoreCache, "function", "and the cache has a test seam, like engineCommit's");
});
