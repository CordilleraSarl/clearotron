// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// engine/openai-agent-program.mjs — the program the Codex engine runs, and what setup says about it.
//
// PURE DATA, AND IT IMPORTS NOTHING. This is the engine's row in ENGINE_BINARIES (driver.config.mjs), which
// the run-door preflight, the turn probe and setup all read. It sits beside the adapter so that a new floor
// for this engine is an edit to this engine's own files. scripts/engine-pins.mjs reads `package` and `floor`
// here as text, so each is written once, as a literal.
export const program = {
  vendor: "OpenAI",
  product: "Codex",
  env: "CLEAROTRON_CODEX_PATH", fallback: "codex",
  // THE FLOOR IS THE OLDEST RELEASE THAT ACCEPTS THE JUDGMENT TIER'S MODEL on a ChatGPT sign-in, which
  // is how a subscription bills. Measured 2026-10-09 with a one-word `codex exec` turn per version on the
  // test box: `gpt-6.1-sol` is refused with a 400 on 0.156.1, 0.157.0 and 0.158.0 ("not supported when
  // using Codex with a ChatGPT account") and accepted on 0.159.0, 0.160.0, 0.161.0 and 0.162.0;
  // `gpt-6-luna` is accepted from 0.156.1. Below the floor every clearance stops at its first
  // judgment-tier stage (the tiers are in engine/openai-agent.mjs). The old floor, 0.154.0, was the
  // permissions feature's (engine/mcp/codex-config.mjs).
  package: "@openai/codex", floor: "0.159.0",
  installMB: 436,   // measured the same way as Claude's (anthropic-agent-program.mjs): setup's command fetched 0.166.0, 2026-11-05; 0.159.0 alone is 424
  licence: "third-party software under the Apache-2.0 licence",   // the package's own "license" field
  label: "OpenAI — each stage runs as a headless `codex exec` turn",
  module: "engine/openai-agent.mjs", adapter: "openaiAgentEngine",
  signIn: "run `codex login`",
  authEnv: "CLEAROTRON_AI_BILLING", apiKeyEnv: "CODEX_API_KEY",
  subscriptionHow: "sign in once with `codex login`",
  // — codex's headless ending writes its own ~/.codex/auth.json; there is no
  // token to capture into an env file, and inventing one would be a route nobody has driven.
  headless: { cmd: "codex login --device-auth", tokenEnv: null },
};
