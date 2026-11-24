// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// register-grant.mjs — the register tools this provider's server is granted, as gather-config.mjs mounts it.
import { REGISTER_TOOLS } from "../../_shared/register-tools.mjs";

// uspto-local: 6 of the 8, and the only provider here that is a FILE rather than an API — the guard
// it fails on is USPTO_LOCAL_DB, not a key. Two tools are absent on purpose, neither stubbed:
//   register_image_fetch    — the USPTO bulk product is text. It carries the drawing CODE (hence
//     mark_feature) and not one byte of image data, so there is no weaker image to serve.
//   register_expand_phoneme — no phonetic surface exists over a plain text column. Unlike clarivate,
//     phonetic SEARCH is unavailable here too (capabilities.predicates.phonetic is null), so such a
//     slice is stamped unsupported at compile time and disclosed as a deferred coverage row.
// Both gaps are declared in providers/uspto-local/src/capabilities.js and the exact six are pinned by
// test/engine.gather.test.mjs, so neither can become a silent omission.
export const REGISTER_GRANT = { script: "register-server.mjs", args: ["uspto-local"],
  tools: REGISTER_TOOLS.filter((t) => t !== "register_expand_phoneme" && t !== "register_image_fetch") };
