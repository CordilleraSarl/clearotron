// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// Whether this is a Linux running under Windows. Shared because two readers need the one answer: the install
// (which binaries on a Windows drive to pass over) and the connect lines (which must say to run them inside
// WSL, where their paths exist).
import { existsSync, readFileSync } from "node:fs";

/**
 * BOTH SIGNALS INJECTABLE, for the reason `platformEngineRefusal` gives: the readers this protects are the
 * ones who cannot run this suite to find out, so a Linux runner has to be able to drive both answers
 * rather than read the source and agree with it.
 *
 * A READ THAT FAILS ANSWERS "NOT WSL", and that is the direction that changes nothing: it leaves the
 * resolution exactly as it was before this existed. Claiming WSL on a could-not-read would start refusing
 * candidates under /mnt on an ordinary Linux box with an ordinary mount.
 */
// THE INTEROP REGISTRATION BOTH GENERATIONS INSTALL, and the reason this file no longer matches a vendor
// string. The older generation's /proc/version carries a vendor name and NOT the token "wsl", so the only
// thing catching it was that name — identifying a platform by a third party's name, on a public surface,
// for want of another signal. This is the other signal, and it names the platform rather than a company.
//
// IT SHIPS ON REASONING, which is worth saying rather than implying. Neither generation runs on any box
// here, so nothing in this suite can demonstrate that the older one registers this entry: the newer one
// demonstrably does, the older one is documented to, and a walk through a real install is the test that
// exists. If it turns out not to, the failure is the one this file already fails safe into — "not WSL",
// which leaves the resolution exactly as it was, rather than claiming WSL on a box that is not one.
export const WSL_INTEROP_ENTRY = "/proc/sys/fs/binfmt_misc/WSLInterop";

export function isWsl({ env = process.env, procVersion = null, interopEntry = null } = {}) {
  if (String(env.WSL_DISTRO_NAME ?? "").trim()) return true;
  if (String(env.WSL_INTEROP ?? "").trim()) return true;
  // Injectable like the other two, and for the same reason this file already gives: the readers this
  // protects cannot run the suite to find out, so a Linux runner has to be able to drive both answers
  // rather than read the source and agree with it.
  const interop = interopEntry ?? (() => { try { return existsSync(WSL_INTEROP_ENTRY); } catch { return false; } })();
  if (interop) return true;
  const v = procVersion ?? (() => { try { return readFileSync("/proc/version", "utf8"); } catch { return ""; } })();
  return /wsl/i.test(v);
}
