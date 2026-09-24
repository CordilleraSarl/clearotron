// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A HOME FOR A CHILD PROGRAM, UNDER BOTH NAMES. Node's os.homedir() reads HOME on Linux and macOS and
// USERPROFILE on Windows, so a test that isolates a child by HOME alone isolates nothing on Windows: the
// product reads and writes the runner's real home. Measured on a Windows runner, 2026-09-23.

/** `{ HOME, USERPROFILE }`, both `dir`, to spread into a child's environment. */
export const homeAt = (dir) => ({ HOME: dir, USERPROFILE: dir });
