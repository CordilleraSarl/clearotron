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
