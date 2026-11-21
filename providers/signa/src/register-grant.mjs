// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// register-grant.mjs — the register tools this provider's server is granted, as gather-config.mjs mounts it.

// signa: 5 of the 8, and the grant is what the server SERVES. It was 2 until and 4 until.
// The 2 was set on 2026-07-21 by 7ef96c7c when signa really was the thin provider — and it never
// moved again. The five
// commits that made it thick (4b3b59ef kernel + enumerate + execute_plan, 4a616899 the plan-vocabulary
// deps, 3468d78c the probed capability contract) touched no file in this directory, so the row was not
// dropped from a diff: it was never in one. `git log -L` on this line returns exactly one commit.
//
// WHAT THAT COST, and why the count pin did not say a word: `allowedToolsFor` is built FROM this row, so
// the per-provider count assertion in engine.gather.test.mjs compared the table with itself and passed at
// 2 — then DEFENDED the gap, because correcting the grant failed it. Signa was also the one provider of
// six with no `handshake + N tools` test, so its advertisement was never compared to anything.
// register-advertisement-vs-grant.test.mjs is the general form: every provider, discovered from this
// table, its real `tools/list` against its resolved grant.
//
// PER TOOL, as every sibling entry does it:
//   register_search / register_record_fetch — served since the thin days.
//   register_enumerate     — SERVED and now granted.  built the page loop on the shared kernel;
//     capabilities.js records the bounds it runs against (a page holds at most 100 records, and the API
//     refuses a larger one). This is the tool the owner-window ceiling is
//     passed into (OWNER_SCOPED_WINDOW → ceilingFor → makeEnumerate), so withholding it put that
//     criterion out of reach of any round.
//   register_execute_plan  — SERVED and now granted. Two corrective-ladder hints name it unconditionally
//     (`tool_timeout`, `named_band_missing`), so while it was withheld a repair turn on this provider was
//     told to make a call its allowlist refused.
//   register_propose_supplemental — SERVED as, and it is the same executor one file over. The
//     mint is shared (mcp/supplemental.mjs); the only per-provider parts are doExecutePlan, which this
//     server already binds for the dictated plan, and the capability contract, which the mint reads to
//     decide what defers. Nothing new reaches the wire. While it was unwired the driver's composed prose
//     ordered the mint UNCONDITIONALLY — `stages.mjs` (the unconditional mint the register-units digest orders) — so a signa deploy was told to
//     make a call no server offered. Measured on  over a real signa run: the order reached three
//     register-unit stages, no call was recorded against it, and the run still read `delivered`.
//
// THE OTHER THREE NEUTRAL NAMES ARE NOT SERVED BY THIS SERVER AT ALL, so they are outside the grant
// question and outside. Each carries its reason, because an absence with no reason is a finding
// rather than a decision:
//   register_batch_screen  — no batch-screen surface and no clearance endpoint; `/v1/analysis/clearance`
//     404s, stated in providers/signa.md.
//   register_expand_phoneme — `phonemeExpansion: false` in the capability contract. READ THAT FIELD
//     NARROWLY: it withholds the client-supplied VARIANT LIST, not phonetic search. `predicates.phonetic`
//     is `"phonetic"`, a native ranked strategy, so a phonetic SWEEP runs here and only the variant
//     PREVIEW is missing — the same shape as clarivate above. Reading it as "no phonetic surface" is how
//     a copied sibling paragraph tells the seat to defer a slice this provider answers.
//   register_image_fetch   — the tool's payload is the VIENNA figurative-element codes and a citable
//     public page, and this provider publishes neither. Read 2026-08-22 across providers/signa/src: no
//     vienna or figurative field anywhere in the core, the normaliser carries `imageAvailable`
//     (`rec.has_media`) and nothing else about the mark's figure, `hasPublicRecordUrl: false` and
//     `resolved_link: null` (no page per record of its own). Serving it would return a
//     bare boolean under a name that promises comparable figurative data. NOT A PROBE: this is a read of
//     the code and the vendor doc in this repo, and whether the live API has an image endpoint nobody
//     wired is UNTESTED from here — euipo's `markImage` looked equally absent until `GET
//     /trademarks/{n}/image` answered 200, so treat this as the current best reading, not a closed
//     question. PINNED, so this paragraph cannot outlive the facts it rests on: the arm
//     " signa's core still carries NO figurative data" in driver/test/register-capabilities.test.mjs
//     reds if a vienna/figurative field appears in providers/signa/src or if hasPublicRecordUrl goes
//     true. If it reds, re-read this reason before you touch the test.
export const REGISTER_GRANT = { script: "register-server.mjs", args: ["signa"],
  tools: ["register_search", "register_record_fetch", "register_enumerate", "register_execute_plan",
    "register_propose_supplemental"] };
