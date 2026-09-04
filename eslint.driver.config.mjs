// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// ONE RULE, OVER EVERY .mjs DIRECTORY WE SHIP: does every identifier resolve to a binding?
//
// ── WIDENED 2026-09-04 ON EVIDENCE, NOT ON PRINCIPLE ───────────────────────
//
// It covered driver/ alone, and one day produced the natural experiment that settles it. Two scope bugs
// of exactly this class shipped within an hour of each other: a helper called from outside the block it
// was declared in (driver/, CAUGHT here in one line), and a variable read from a caller's scope in
// bin/connect.mjs (NOT caught, because bin/ was outside the glob). The second reached a merge and threw
// ReferenceError on every served http client.
//
// Widening it found two more latent ones immediately, both real: a `statSync` never imported, and — the
// worse one — `export { originRepo } from …`, which creates NO local binding, so the call below it threw
// the moment that file ran as an entrypoint. Both fixed in the commit that widened this, because the
// paragraph below is right that a lint greenlighting a backlog certifies it. The backlog outside driver/
// was two, and now it is none.
//
// The script is still named lint:driver. That is historical and CI calls it by that name.
//
// — `runLog(run.runDir, …)` was written inside a function that destructures `const P = ctx.paths`
// and has no `run` binding at all. Syntactically valid, imports fine, and a ReferenceError the first time
// that branch is reached on a live run. Three layers were blind to it: there is no typecheck over driver/
// (CI's typecheck step is `-w portal-ui`), the function is not exported so no test can reach the line, and
// the PR's own wiring assertions read SOURCE TEXT — exactly the shape that passes on a valid reference to
// a binding that does not exist. The full driver suite was green with it in place. It was caught by
// reading the enclosing scope on a hunch, and nothing else would have.
//
// Live runs cost real money, so "we would have caught it in testing" is not available for this class.
//
// DELIBERATELY NOT A FULL LINT. One rule, no style opinions, and no ratchet file — because the measured
// backlog was three violations in one file, all real, all fixed in the commit that added this. A lint that
// greenlights an existing backlog certifies it; there was nothing here to certify.
//
// `reportUnusedDisableDirectives` is deliberately OFF. With a single rule enabled, every `eslint-disable`
// naming any OTHER rule reads as unused — three did — and that is an artefact of this config's narrowness,
// not a finding about the code.
import globals from "globals";

export default [
  {
    files: ["driver/**/*.mjs", "bin/**/*.mjs", "shared/**/*.mjs", "mcp-server/**/*.mjs", "scripts/**/*.mjs", "cut/**/*.mjs"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: { ...globals.node, ...globals.es2024 },
    },
    // Explicit, not defaulted: ESLint 10 turns this on at "warn" unless told otherwise, and it then
    // reported three directives as unused for the reason given above.
    linterOptions: { reportUnusedDisableDirectives: "off" },
    rules: { "no-undef": "error" },
  },
];
