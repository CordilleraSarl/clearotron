// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// env-file-merge.mjs — add values to a `.env` body without ever losing one.
//
// Moved here from bin/start.mjs because a SECOND writer now needs it: the
// documented hosted install has to place the portal's engine-door origin, and a `driver/` module
// importing a `bin/` CLI to borrow a pure text function is the wrong direction. The behaviour is
// unchanged; only the attribution line is now the caller's to name, since "Added by `npm start`" is
// false when the installer wrote it.

/**
 * Add the named values to a `.env` body, ADD-ONLY.
 *
 * Never rewrites, reorders or drops an existing line. `npm run setup` writes that file wholesale and it
 * holds the reader's provider credentials; a launcher that regenerated it would be a launcher that can
 * lose them. Returns the new text and the names actually added (never the values).
 *
 * @param {string} text        the existing body, or anything falsy for a new file
 * @param {object} additions   name → value; empty and nullish values are skipped, never written blank
 * @param {{by?: string, notes?: object}} opts `notes[NAME]` is written as a comment ABOVE that line.
 *                             A written line is an example whether or not it means to be: this file
 *                             holds names taking OPPOSITE path conventions one heading apart, so a
 *                             value written without its shape rule invites a reader to copy the shape
 *                             rather than the rule. `by` names the writer in the file's own comments, so a reader can tell
 *                             which command put a line there. Defaults to the launcher, which is who
 *                             wrote every such line before this moved.
 * @param {string[]} opts.refresh  names this call MINTS rather than collects, which are replaced in
 *                             place when already present. Add-only is right for everything a person
 *                             typed and wrong for everything the launcher generates: a minted value
 *                             that is never rewritten is a value that ages to expiry on a working
 *                             server while every start reports success. The portal's trigger key did
 *                             exactly that — thirty days after the first `start --background`, every
 *                             Start stopped, and the failure arrived as an upstream refusal that reads
 *                             like an engine fault. Names here must be values this code MINTS; putting
 *                             a credential a reader supplied in this list would delete their work.
 */
export function mergeEnvFile(text, additions, { by = "`npm start` (bin/start.mjs)", notes = {}, refresh = [] } = {}) {
  const body = typeof text === "string" ? text : "";
  const present = new Set();
  for (const line of body.split("\n")) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line);
    if (m) present.add(m[1]);
  }
  // AN EMPTY VALUE IS NOT A VALUE, and this is load-bearing rather than tidy: the deployment env example
  // ships `PORTAL_MCP_URL=` empty on purpose, so a body already carrying that name is "present" and is
  // left alone — writing the derived origin under it would put two assignments in one file and let the
  // last one win silently.
  const refreshable = new Set(refresh);
  const usable = ([, v]) => v != null && v !== "";
  const add = Object.entries(additions).filter(([k, v]) => !present.has(k) && usable([k, v]));
  // REPLACED IN PLACE, not appended: two assignments of one name in a `.env` is a file whose meaning
  // depends on which reader you ask, and the line keeps its position and whatever comment sits above it.
  const renew = Object.entries(additions).filter(([k, v]) => present.has(k) && refreshable.has(k) && usable([k, v]));
  let out = body;
  for (const [k, v] of renew) {
    out = out.split("\n").map((line) => (new RegExp(`^\\s*${k}\\s*=`).test(line) ? `${k}=${v}` : line)).join("\n");
  }
  if (!add.length) return { text: out, added: [], refreshed: renew.map(([k]) => k) };
  const bodyForAppend = out;
  const header = bodyForAppend.trim().length ? "" : `# Written by ${by}. Environment variables always win over this file.\n`
    + "# It holds secrets: keep it at mode 600, and out of git (.gitignore already covers it).\n";
  const gap = bodyForAppend.length && !bodyForAppend.endsWith("\n") ? "\n" : "";
  const block = `\n# Added by ${by}. Delete a line to have it generated afresh.\n`
    + add.map(([k, v]) => (notes[k] ? `# ${k}: ${notes[k]}\n` : "") + `${k}=${v}\n`).join("");
  return { text: header + bodyForAppend + gap + block, added: add.map(([k]) => k), refreshed: renew.map(([k]) => k) };
}
