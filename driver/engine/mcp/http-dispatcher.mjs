// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// Raise undici's default 300s headersTimeout for the ENGINE's outbound HTTP.
//
// Why: the Perplexity agent API runs the whole grid sandbox program SERVER-SIDE before returning any
// headers, so a large grid (e.g. a 340-cell common-law half = 20 terms × 17 platforms) legitimately takes
// >300s. node's global fetch (undici) aborts at its default 300s headersTimeout and surfaces it as a
// generic `TypeError: fetch failed`, which the model then reports as the grid being "unavailable" — the
// 2026-07-17 AquaPlus `common-law-half:b` failure. A retries:0 reproduction probe of that exact call died
// at 300.8s with `UND_ERR_HEADERS_TIMEOUT`, proving it is OUR client aborting, not a Perplexity failure.
//
// Import for SIDE EFFECT once per process: every wrapped MCP server (via stdio-server.mjs → covers
// perplexity/corsearch/euipo) and the driver itself (runner.mjs / pipeline.mjs → covers code-side
// corsearch fetches). Env-tunable via CLEAROTRON_HTTP_TIMEOUT_MS. The default (30 min) sits UNDER the
// common-law stage wall (2250s) so a genuinely-hung call is still killed by the stage, never left
// indefinite. The change is strictly MORE lenient — it can only let a slow-but-live call finish; it never
// shortens or breaks a fast one.
import { Agent, setGlobalDispatcher } from "undici";

// Pure — exported for tests. Default 30 min; env-overridable; sub-second/garbage values fall back.
export function resolveTimeoutMs(env = process.env) {
  const n = Number(env.CLEAROTRON_HTTP_TIMEOUT_MS);
  return Number.isFinite(n) && n >= 1000 ? Math.floor(n) : 1_800_000; // 30 min
}

export const ENGINE_HTTP_TIMEOUT_MS = resolveTimeoutMs();

setGlobalDispatcher(new Agent({
  headersTimeout: ENGINE_HTTP_TIMEOUT_MS,
  bodyTimeout: ENGINE_HTTP_TIMEOUT_MS,
  connectTimeout: 10_000,
}));
