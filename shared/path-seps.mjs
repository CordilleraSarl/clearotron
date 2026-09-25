// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// path-seps.mjs — THE SEPARATOR A PATH WAS BUILT WITH, for code that reads a path with a regex.
//
// `join` builds a path with the platform's own separator: "/" on Linux and macOS, "\" on Windows. A regex
// written against "/" matches nothing on Windows, so the reader that holds it says "not a run directory"
// or "no agent" about a path that is both, and the grid tool refused every full clearance that way.
//
// WINDOWS ACCEPTS BOTH, so both are separators there. On Linux and macOS "\" is an ordinary filename
// character, so it stays one: the class is chosen from the platform, and a Linux path reads exactly as it
// did before this file existed. `platform` is a parameter so the Windows branch runs on a Linux CI.

import { STUDIO_SEGMENT_RE } from "./pre-rename-spellings.mjs";

/** A regex source matching one path separator on `platform`. */
export function sepClass(platform = process.platform) {
  return platform === "win32" ? "[\\\\/]" : "/";
}

/** A regex source matching one character that is not a path separator on `platform`. */
export function notSepClass(platform = process.platform) {
  return platform === "win32" ? "[^\\\\/]" : "[^/]";
}

/** Everything after the last separator: the file's own name. */
export function lastSegment(p, platform = process.platform) {
  const s = String(p ?? "");
  const cut = platform === "win32" ? Math.max(s.lastIndexOf("/"), s.lastIndexOf("\\")) : s.lastIndexOf("/");
  return s.slice(cut + 1);
}

/** Does the path hold a separator at all, as opposed to being a bare name? */
export function hasSep(p, platform = process.platform) {
  const s = String(p ?? "");
  return s.includes("/") || (platform === "win32" && s.includes("\\"));
}

/** Is `p` inside a run directory: somewhere under `…/studio/<either segment spelling>/`? */
export function underStudioSegment(p, platform = process.platform) {
  const S = sepClass(platform);
  return new RegExp(`${S}studio${S}${STUDIO_SEGMENT_RE}${S}`).test(String(p ?? ""));
}
