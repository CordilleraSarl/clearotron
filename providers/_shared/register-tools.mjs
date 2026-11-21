// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// register-tools.mjs — the neutral register tool names every provider's grant is drawn from (gather-config.mjs mounts them).
//
// ── The register surface is PROVIDER-NEUTRAL ────────────────────────────────────────────────────
// The active register provider is mounted under the single server key `register`, and every register
// tool is named `register_*`. The vendor's name survives ONLY inside its own *-server.mjs file and in
// skills/clearance-register/providers/<provider>.md (the vocabulary doc the spawns are told to read).
//
// Why neutral names rather than interpolating `${PROVIDER}_enumerate` into the prose: the register
// instructions in stages.mjs / pipeline.mjs / gateway.mjs are then correct BY CONSTRUCTION for every
// provider, and the namespaced ids (`mcp__register__register_enumerate`) stay stable across a swap.
//
// THIS USED TO CLAIM MORE THAN IT COULD KEEP. The old sentence ended "— so an excludeTools entry
// or a corrective-ladder nudge cannot silently name a tool that isn't loaded", and a stable NAME is not a
// loaded tool: signa served four of these eight while its grant carried two, so two ladder hints named
// tools its allowlist refused, and a third names one signa does not serve at all. What is true is now
// enforced instead of asserted here, in two places that fail rather than describe:
//   · register-advertisement-vs-grant.test.mjs — every provider grants exactly what its server advertises,
//     compared against the server's real tools/list, with any withholding written down;
//   · the same file's second arm — every neutral tool the driver's composed prose ORDERS is served by every
//     provider, with the one live exception named and required to still reproduce.
// A provider that cannot implement one of these tools must fail LOUDLY (and its gap becomes a
// `deferred` coverage row); it must never quietly expose a weaker substitute under the same name.
export const REGISTER_TOOLS = [
  "register_search", "register_record_fetch", "register_image_fetch", "register_expand_phoneme",
  "register_batch_screen", "register_enumerate", "register_execute_plan", "register_propose_supplemental",
];
