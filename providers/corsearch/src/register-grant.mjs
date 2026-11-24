// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// register-grant.mjs — the register tools this provider's server is granted, as gather-config.mjs mounts it.
import { REGISTER_TOOLS } from "../../_shared/register-tools.mjs";

export const REGISTER_GRANT = { script: "register-server.mjs", args: ["corsearch"], tools: REGISTER_TOOLS };
