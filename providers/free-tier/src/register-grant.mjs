// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// register-grant.mjs — the register tools this provider's server is granted, as gather-config.mjs mounts it.
import { REGISTER_TOOLS } from "../../_shared/register-tools.mjs";

// free-tier: EUIPO + the local US index as ONE register — 7 of the 8. The surface is the UNION
// of what its members can serve, not the intersection, because a tool one member serves is still a
// real capability of the composite:
//   register_image_fetch    — SERVED. EUIPO answers with image bytes; a US record refuses as a stated
//     SOURCE LIMITATION. "The index holds no images" and "this record has no image" are different
//     facts and the tool says which one it means.
//   register_expand_phoneme — ABSENT, and here the intersection and the union agree: NEITHER member
//     has a phonetic surface, so predicates.phonetic is null and a phonetic slice defers rather than
//     degrading into a contains under the phonetic name.
export const REGISTER_GRANT = { script: "register-server.mjs", args: ["free-tier"],
  tools: REGISTER_TOOLS.filter((t) => t !== "register_expand_phoneme") };
