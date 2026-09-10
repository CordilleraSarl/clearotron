#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// clearotron framework — read a risk framework and its manifest, and say what they declare.
//
// The command a customer's counsel runs after writing the pair and before pointing a company at it.
// It creates nothing, rates nothing and calls nobody: it opens the two files exactly as a run would,
// reports the ladder in the framework's own order, and where the deck and the manifest disagree it
// names the band and says what the deck did not do.
//
// WHY IT IS ITS OWN COMMAND rather than a flag on the onboarding one. `brandowner add --dry-run`
// answers "would this create the company I meant", and it does check the framework loads — but a person
// writing a rubric has no company to create yet, and telling them to phrase their question as a
// half-finished onboarding is how a check goes unrun. The onboarding command prints this same report,
// from this same module, so the two can never disagree about what a valid framework is.

import { isEntrypoint } from "../shared/is-entrypoint.mjs";
import { invocationPrefix } from "../shared/invocation.mjs";
import { preflightFramework, formatPreflight } from "../driver/framework-preflight.mjs";

const USAGE = (cmd) => `
  ${cmd} framework <skills/prelim-search/your-framework.md>

    Reads a risk framework deck and the manifest beside it, and reports what they declare —
    the ladder, the company the deck names, the shape, and which file answered where.
    Creates nothing. Rates nothing. Contacts nobody.

    The path is the one a profile carries: it starts with skills/ and is resolved the way a
    run resolves it, so this reads the file a matter would actually be rated under.

  Exit codes: 0 the deck and the manifest agree · 1 not ready, with the reason · 2 usage
`;

export function preflightMain(argv, { out = console.log, err = console.error } = {}) {
  const cmd = invocationPrefix();
  const args = argv.filter((a) => a !== "--");
  if (args.includes("--help") || args.includes("-h")) { out(USAGE(cmd)); return 0; }
  if (args.length !== 1 || args[0].startsWith("-")) { err(USAGE(cmd)); return 2; }

  const report = preflightFramework(args[0]);
  out(formatPreflight(report));
  // A substitution is not a refusal — the pair may be perfectly valid — but it is the finding this
  // command exists to surface, so it is never the difference between exit 0 and exit 1 and is never
  // silent either. The line is printed above by the formatter.
  return report.ok ? 0 : 1;
}

if (isEntrypoint(import.meta.url)) process.exit(preflightMain(process.argv.slice(2)));
