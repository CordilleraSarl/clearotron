// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// What `clearotron demo` hands the supervisor it starts. In its own module because the launcher runs a
// demo the moment it is loaded, so a rule living there could only be tested by starting one.

/**
 * What the demo hands the supervisor. PURE, and exported so the rule is driven as a table rather than by
 * starting a portal.
 *
 * The base is always passed, because this launcher lays the program copy and the samples down there
 * before the supervisor starts. So whether the READER chose it has to travel separately:
 * `--demo-own-base` says it is the demo's default, which is what lets the supervisor remove the folder
 * when the window closes. `--keep` is the reader's, and it travels as given.
 */
/**
 * The Node flag the demo runs under, so Node's one-time warning that its built-in SQLite is experimental
 * does not land on the demo's first screen. Named once: the launcher puts it on the demo's own process,
 * and `bin/example.mjs` hands it to the services it starts through NODE_OPTIONS.
 */
export const EXPERIMENTAL_WARNING_OFF = "--disable-warning=ExperimentalWarning";

/** The same flag added to whatever NODE_OPTIONS the reader already has, which is kept. PURE. */
export const withWarningOff = (nodeOptions) => [nodeOptions, EXPERIMENTAL_WARNING_OFF].filter(Boolean).join(" ");

export function demoStartArgs({ demoBase, readerBase = false, keep = false, port = null, noOpen = false } = {}) {
  const args = ["--demo", "--base", demoBase];
  if (!readerBase) args.push("--demo-own-base");
  if (keep) args.push("--keep");
  if (port) args.push("--port", String(port));
  if (noOpen) args.push("--no-open");
  return args;
}
