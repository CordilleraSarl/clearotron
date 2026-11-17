// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// Where each register provider states its tools. The population comes from the table the grant is built from,
// so a new provider is covered the day it is added. Not a test file.
import { join } from "node:path";

import { REGISTER_SERVERS } from "../engine/mcp/gather-config.mjs";
import { DRIVER } from "./model-stage-dispatches.mjs";

/** `{ provider, path }` for every register provider's mount. */
export const registerMounts = () => Object.keys(REGISTER_SERVERS)
  .map((provider) => ({ provider, path: join(DRIVER, "..", "providers", provider, "src", "mount.js") }));
