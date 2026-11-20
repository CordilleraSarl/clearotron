// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// engine/anthropic-agent-program.mjs — the program the Claude engine runs, and what setup says about it.
//
// PURE DATA, AND IT IMPORTS NOTHING. This is the engine's row in ENGINE_BINARIES (driver.config.mjs), which
// the run-door preflight, the turn probe and setup all read. It sits beside the adapter so that a new floor
// for this engine is an edit to this engine's own files. scripts/engine-pins.mjs reads `package` and `floor`
// here as text, so each is written once, as a literal.
export const program = {
  // `vendor` is the one word a person needs — the staff config page answers "which engine is
  // running the searches", and `label` below is the MECHANISM, which is what took off that page.
  vendor: "Anthropic",
  // `product` is the name a reader knows the program by, beside the vendor in setup's engine question
  // ("Claude, by Anthropic"). Not `fallback`, which is the command word and lower-case.
  product: "Claude",
  env: "CLEAROTRON_CLAUDE_PATH", fallback: "claude",
  // The npm package that carries this program, and the oldest version setup installs: "this version or
  // newer", with no ceiling. Setup installs it into the engines folder (enginesFolder, in driver.config.mjs)
  // when the reader picks this engine, and the resolver uses it only when the machine has no copy of its
  // own. The package's own `bin` field names the program, so no path inside it is written down here.
  // THE FLOOR IS THE OLDEST RELEASE WHOSE TIER ALIASES REACH THE CURRENT MODEL GENERATION, and each
  // tier crossed on its own release rather than together. Measured 2026-09-30 by driving each version's
  // `-p` turn at a local recorder and reading the `model` it put on the wire:
  //
  //     version   --model opus        --model sonnet
  //     2.1.277    claude-opus-5       claude-sonnet-5
  //     2.1.278    claude-opus-5       claude-sonnet-5
  //     2.1.280    claude-opus-5-5     claude-sonnet-5
  //     2.1.281    claude-opus-5-5     claude-sonnet-5
  //     2.1.282    claude-opus-5-5     claude-sonnet-5
  //     2.1.283    claude-opus-5-5     claude-sonnet-5
  //     2.1.284    claude-opus-5-5     claude-sonnet-5-5
  //
  // So the old floor of 2.1.280 was exactly right for the top tier and left the sonnet tier a
  // generation behind for four releases, silently: the alias resolves inside the program, the request
  // is well formed either way, and nothing refuses. The floor moves to the release where the SECOND
  // tier crosses, because a stage that asks for sonnet is asking for the current sonnet.
  //
  // Below the floor the previous behaviour still holds: on 2.1.263 the alias returned the older model
  // and a pinned id was refused outright ("version 2.1.280 or newer is required"), measured 2026-09-22.
  // A floor that only asks for a program that starts is a floor that passes a machine this engine
  // cannot run the current generation on.
  //
  // THE HAIKU TIER CROSSED LATER, when Claude Haiku 5.5 joined the generation. Measured 2026-10-09 by a
  // one-word `-p` turn per version on the test box's own sign-in, reading the model the turn reports in
  // `modelUsage`:
  //
  //     version   --model haiku
  //     2.1.285    claude-haiku-4-5-20251001
  //     2.1.287    claude-haiku-4-5-20251001
  //     2.1.288    claude-haiku-4-5-20251001
  //     2.1.289    claude-haiku-4-5-20251001
  //     2.1.290    claude-haiku-4-5-20251001
  //     2.1.292    claude-haiku-4-5-20251001
  //     2.1.293    claude-haiku-5-5
  //     2.1.294    claude-haiku-5-5
  //     2.1.295    claude-haiku-5-5
  //
  // 2.1.295 still serves claude-opus-5-5 and claude-sonnet-5-5. The floor moves to 2.1.293 for the reason
  // it moved to 2.1.284: a stage that asks for haiku is asking for the current haiku.
  package: "@anthropic-ai/claude-code", floor: "2.1.293",
  // WHAT THE INSTALL TAKES ON DISK, in MB, which setup states before it asks to install. MEASURED, not
  // declared by the vendor: the engines folder (`du -sm`) after a fresh install into an empty folder with
  // setup's own command, which fetches the newest release at or above the floor rather than the floor
  // itself. Measured 2026-11-05 on npm 10.9.9: 323 MB for 2.1.318; 2.1.293 alone is 242. A later release
  // can be larger or smaller, so setup says "about". Re-measure when the floor moves.
  installMB: 323,
  // The licence setup states wherever it tells a reader what they are about to install or use, as the
  // vendor's package declares it: "SEE LICENSE IN README.md", Anthropic's own terms.
  licence: "proprietary third-party software",
  label: "Anthropic — each stage runs as a headless `claude -p` turn",
  module: "engine/anthropic-agent.mjs", adapter: "anthropicAgentEngine",
  signIn: "run `claude` once in a terminal and complete the sign-in",
  authEnv: "CLEAROTRON_AI_BILLING", apiKeyEnv: "ANTHROPIC_API_KEY",
  subscriptionHow: "sign in once with `claude`",
  // `install`, the command that puts this program in the engines folder, is written in by driver.config.mjs
  // from `package` and `floor`, so the command a reader is shown and the one setup runs cannot drift.
  // npm, NOT the vendor's shell installer: a command this product executes on someone's box has to be
  // one they can read in full before they answer, and a piped remote script is not.
  // — the documented headless ending. `claude setup-token` walks the sign-in and
  // prints a long-lived token; the stage subprocess env is a list (engine/engine-env.mjs) that carries the
  // vendor's own `CLAUDE_*` names — the API key is the one name it keeps only under `api-key` — so a token
  // in the env file reaches the CLI untouched, and that is the whole mechanism (armed in
  // engine.anthropic.test.mjs). The wizard
  // captures it by paste: the vendor's stream layout is not ours to guess at, and a paste works
  // whatever it prints where.
  headless: { cmd: "claude setup-token", tokenEnv: "CLAUDE_CODE_OAUTH_TOKEN" },
};
