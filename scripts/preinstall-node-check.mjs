// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// The install refuses an unsupported Node BEFORE anything is written — tracker issue 364.
//
// Three declarations already stated the requirement and none of them bound anyone: `engines.node` is a
// WARNING unless the person installing has set `engine-strict`, `.nvmrc` is read by nvm and nothing
// else, and the install guide is prose. An outside report arrived as "some node issues, not as obvious
// as the README made it seem" — which is what a warning inside an install log looks like from outside.
//
// So this is a `preinstall` hook, node builtins only, because nothing is installed when it runs.
//
// IT NAMES THE LATER FAILURE, not just the version. The whole defect is that an unsupported Node
// installs cleanly and then fails somewhere else saying nothing about Node, so a message that only
// prints a semver range leaves the reader where they started.
import { declaredRange, floorOf, meetsFloor, nodeFloorRefusal } from "../shared/node-floor.mjs";

const range = declaredRange();
if (!meetsFloor(process.versions.node, floorOf(range))) {
  process.stderr.write(`\n${nodeFloorRefusal({ current: process.versions.node, required: floorOf(range).join("."), range })}\n`);
  process.stderr.write("  Nothing has been installed.\n\n      nvm install 22 && nvm use 22\n\n");
  process.stderr.write("  Without nvm, take the current 22.x from https://nodejs.org/.\n\n");
  process.exit(1);
}
