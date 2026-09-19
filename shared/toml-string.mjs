// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// ONE TOML STRING ENCODER, for every block this product writes.
//
// Two composers write TOML: the engine's per-run Codex configuration and the connection block a reader
// pastes into `~/.codex/config.toml`. The second wrapped raw values in double quotes, so a Windows path
// such as `C:\Program Files\nodejs\node.exe` produced a file TOML parsers refuse ("Unescaped '\' in a
// string"). A value is a TOML string only once it has been through here.

/**
 * A TOML basic string holding exactly `s`. PURE.
 *
 * TOML requires the quotation mark, the backslash and every control character other than tab to be
 * escaped (U+0000 to U+0008, U+000A to U+001F, and U+007F). The named escapes are used where TOML has one,
 * and `\uXXXX` for the rest.
 */
export function tomlString(s) {
  const esc = String(s ?? "")
    .replace(/\\/g, "\\\\").replace(/"/g, '\\"')
    .replace(/\x08/g, "\\b").replace(/\t/g, "\\t").replace(/\n/g, "\\n")
    .replace(/\f/g, "\\f").replace(/\r/g, "\\r")
    .replace(/[\x00-\x1f\x7f]/g, (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"));
  return `"${esc}"`;
}
