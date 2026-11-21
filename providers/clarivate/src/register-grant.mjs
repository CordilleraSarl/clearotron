// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// register-grant.mjs — the register tools this provider's server is granted, as gather-config.mjs mounts it.
import { REGISTER_TOOLS } from "../../_shared/register-tools.mjs";

// clarivate: 7 of the 8. `register_expand_phoneme` is ABSENT ON PURPOSE — the ranked-similarity
// surface that would preview phoneme variants is not available on this provider (HTTP 403),
// and doctrine 2 forbids stubbing it with something weaker. Phonetic SEARCH still works
// (match_mode:"phonetic"); only the variant PREVIEW is unavailable. The gap is declared in
// providers/clarivate/src/capabilities.js (phonemeExpansion:false) and pinned by
// test/engine.gather.test.mjs, so it can never become a silent omission.
export const REGISTER_GRANT = { script: "register-server.mjs", args: ["clarivate"], tools: REGISTER_TOOLS.filter((t) => t !== "register_expand_phoneme") };
