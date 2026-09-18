// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// THE THREE ACCOUNT NAMES THE TEST FIXTURES USE, AND THE ONE PLACE THEY ARE WRITTEN DOWN.
//
// These are invented. They name no company, and they exist so the suite can exercise a multi-account
// install without inventing one per test. They are listed here in the open because a list of made-up
// names is not worth a secret, and a check a contributor cannot read is a check a contributor trips
// over: run the packing check locally, read this file, and the refusal explains itself.
//
// WHAT THIS LIST IS FOR. The published package ships fixtures nobody outside this repository can use,
// and a name from that set appearing in the packed bytes means one got through. The check that reads
// this list runs against the tarball, not the tree, because the tree is not what is published.
//
// WHAT IT IS NOT FOR. Real customer names are not here and must never be added — this file is public.
// They are covered before a merge by the private checks, which is where a name nobody may publish
// belongs. Adding one here would put it in exactly the place it must not be.
export const TEST_ACCOUNT_NAMES = Object.freeze(["aurora", "petcary", "zephyr"]);

// ── ONE OF THE THREE IS ALSO AN ORDINARY ENGLISH WORD ────────────────────────────────────────────
//
// `zephyr` is a lightweight cloth, and the shipped register reference data carries it as a goods term
// in Nice class 24 — `providers/jx-subclass/public/goods.jsonl`, one line, measured 2026-09-08:
//
//     {"basic_no":"240094","nice_class":24,"name_en":"zephyr [cloth]","name_zh_tw":"薄織布"}
//
// That is a register describing cloth, not an account name in the package. Without this exemption the
// check refuses every release on it, and a gate that cannot pass a correct package is not a gate — it
// is an outage with a good reason.
//
// KEYED ON WHAT THE LINE SAYS, NOT ON WHERE IT SITS. A path exemption would clear the whole file, so a
// genuine leak into register data would ride out with it. A line matching one of these strings is
// exempt; the same name anywhere else in the same file is still a refusal.
export const ALLOWED_CONTEXTS = Object.freeze(["zephyr [cloth]"]);

// ── AND ONE PLACE WHERE THE BARE WORD IS THE POINT ───────────────────────────────────────────────
//
// The engine ships an English word list, `driver/wordlists/en.txt`: 63,906 ordinary words, one per line,
// and `zephyr` is one of them. It is what stops the form floor searching one-letter neighbours that are
// ordinary words with a different sound, so it has to reach an install — excluding it from `files[]`
// would take the behaviour out with it. Measured 2026-09-18, on the beta it first shipped in: this check
// refused the packed bytes on that one line, at the last step of the publish job, where a refusal
// strands a cut whose version is already stamped.
//
// A LINE THAT IS EXACTLY THE NAME, IN ONE OF THESE FILES, IS THE FILE LISTING THE WORD. Anything else on
// the line is still a refusal, so a leak written into the same file — a name with any other text beside
// it — is caught as before. The list's bytes are pinned by sha256 elsewhere in the tree, so it cannot
// drift into cover for anything. `aurora` and `petcary` are not in it, and neither is invented cover:
// the exemption is per line, not per file.
export const ALLOWED_WORD_LISTS = Object.freeze(["driver/wordlists/en.txt"]);
