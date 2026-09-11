// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// Whether this is a Linux running under Windows. Shared because two readers need the one answer: the install
// (which binaries on a Windows drive to pass over) and the connect lines (which must say to run them inside
// WSL, where their paths exist).
import { readFileSync } from "node:fs";

/**
 * BOTH SIGNALS INJECTABLE, for the reason `platformEngineRefusal` gives: the readers this protects are the
 * ones who cannot run this suite to find out, so a Linux runner has to be able to drive both answers
 * rather than read the source and agree with it.
 *
 * A READ THAT FAILS ANSWERS "NOT WSL", and that is the direction that changes nothing: it leaves the
 * resolution exactly as it was before this existed. Claiming WSL on a could-not-read would start refusing
 * candidates under /mnt on an ordinary Linux box with an ordinary mount.
 */
export function isWsl({ env = process.env, procVersion = null } = {}) {
  if (String(env.WSL_DISTRO_NAME ?? "").trim()) return true;
  if (String(env.WSL_INTEROP ?? "").trim()) return true;
  const v = procVersion ?? (() => { try { return readFileSync("/proc/version", "utf8"); } catch { return ""; } })();
  return /microsoft|wsl/i.test(v);
}
