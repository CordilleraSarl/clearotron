// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveTimeoutMs } from "../engine/mcp/http-dispatcher.mjs";

// Root cause of the 2026-07-17 AquaPlus common-law-half:b failure: undici's default 300s headersTimeout
// aborted the long (>300s) grid call as a generic "fetch failed" (UND_ERR_HEADERS_TIMEOUT — proven by a
// retries:0 probe that died at 300.8s). This bootstrap raises undici's timeout engine-wide.

test("resolveTimeoutMs: default is 30min (above undici's 300s, under the 2250s stage wall)", () => {
  assert.equal(resolveTimeoutMs({}), 1_800_000);
});

test("resolveTimeoutMs: CLEAROTRON_HTTP_TIMEOUT_MS overrides; garbage/sub-second falls back to the default", () => {
  assert.equal(resolveTimeoutMs({ CLEAROTRON_HTTP_TIMEOUT_MS: "600000" }), 600_000);
  assert.equal(resolveTimeoutMs({ CLEAROTRON_HTTP_TIMEOUT_MS: "not-a-number" }), 1_800_000);
  assert.equal(resolveTimeoutMs({ CLEAROTRON_HTTP_TIMEOUT_MS: "0" }), 1_800_000);
  assert.equal(resolveTimeoutMs({ CLEAROTRON_HTTP_TIMEOUT_MS: "12000.9" }), 12_000);
});

test("importing the bootstrap installs a global undici dispatcher (side effect, no throw)", async () => {
  const mod = await import("../engine/mcp/http-dispatcher.mjs");
  assert.equal(mod.ENGINE_HTTP_TIMEOUT_MS, 1_800_000);
  const { getGlobalDispatcher } = await import("undici");
  assert.ok(getGlobalDispatcher(), "setGlobalDispatcher installed a dispatcher");
});
