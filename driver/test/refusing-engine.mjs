#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// The engine binary `scripts/test-run.mjs` pins in place of `claude`/`codex`, so that a unit suite
// which forgot to pin a mock FAILS instead of spending a real subscription turn.
//
// WHY THIS EXISTS RATHER THAN mock-claude.mjs BEING THE DEFAULT: a mock that answers is indis-
// tinguishable, from the suite's side, from a real engine that answers. The suite goes green either
// way, so nothing ever reports that the pin was missing. This one cannot be mistaken for an engine —
// it only ever refuses, and it names the pin it wanted.
//
// The wrapper's banner has said "no model is called, nothing is spent" since. Nothing enforced
// it: on 2026-08-23 a suite run under that banner reached the real `claude` on PATH and spent 284
// opus-5 turns. This file is what makes the banner true for the binary-spawning engines.

// Consume stdin to EOF first. The engine writes the prompt then closes; exiting before that read
// leaves the parent with an EPIPE, which surfaces as a transport fault and buries the message below.
process.stdin.resume();
process.stdin.on("data", () => {});
const refuse = () => {
  process.stderr.write(
    "\nCT_REFUSING_ENGINE_STUB — a test spawned a real engine binary.\n\n"
    + "  scripts/test-run.mjs pins this stub over CLEAROTRON_CLAUDE_PATH / CLEAROTRON_CLAUDE_PATH (and the\n"
    + "  codex pair) so an unpinned suite cannot reach a live subscription. Reaching this message means\n"
    + "  a test dispatched a stage without pinning the mock engine.\n\n"
    + "  THE FIX, in the test that spawned this. Pin through the alias helper, never by assigning one\n"
    + "  spelling: it writes EVERY spelling from the alias table, so neither name can win over the other.\n"
    + "      import { pinEnv, pinEnvAll } from \"../../shared/env-aliases.mjs\";\n"
    + "      pinEnv(process.env, \"CLEAROTRON_CLAUDE_PATH\", join(HERE, \"mock-claude.mjs\"));\n"
    + "  and for a child env built by hand:\n"
      + "      pinEnvAll(childEnv, { \"CLEAROTRON_AI\": \"anthropic-agent\", \"CLEAROTRON_CLAUDE_PATH\": CLAUDE });\n\n"
    + "  If a real engine is genuinely what this run wants:  CT_ALLOW_REAL_ENGINE=1 <command>\n"
    + "  That is loud on every run, by design.\n\n",
  );
  process.exit(1);
};
process.stdin.on("end", refuse);
process.stdin.on("error", refuse);
