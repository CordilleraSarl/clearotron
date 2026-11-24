// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// register-grant.mjs — the register tools this provider's server is granted, as gather-config.mjs mounts it.
import { REGISTER_TOOLS } from "../../_shared/register-tools.mjs";

// euipo: 7 of the 8, the same count as clarivate and for the same missing tool.
// `register_expand_phoneme` is ABSENT ON PURPOSE — there is no phonetic surface here to preview
// variants of. `=phonetic=`, `=fuzzy=` and RSQL's own `~=` all return HTTP 400 at a valid `size`
// (probed 2026-08-09), so unlike clarivate phonetic SEARCH is unavailable too:
// capabilities.predicates.phonetic is null, the planner stamps the slice `unsupported`, and it
// surfaces as a deferred coverage row rather than a contains wearing the phonetic name.
//
// `register_image_fetch` IS here, and was nearly dropped: the detail record's `markImage` carries
// only {imageFormat, viennaClasses} with no bytes and no URL, which reads like an empty field.
// `GET /trademarks/{n}/image` answers 200 with real image bytes. The tool serves the Vienna
// figurative-element codes — the comparable data — rather than the bytes.
export const REGISTER_GRANT = { script: "register-server.mjs", args: ["euipo"],     tools: REGISTER_TOOLS.filter((t) => t !== "register_expand_phoneme") };
