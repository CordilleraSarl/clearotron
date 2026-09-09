// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// register-selection.mjs — THE REGISTERS AN OPERATOR PICKS FROM, and which credentials each one needs.
//
// ── WHY THIS IS NOT IN THE WIZARD ANY MORE ──────────────────────────────────────────────────────────
//
// It lived in `bin/onboard.mjs`, and `driver/run-requirements.mjs`'s header recorded what that cost: the
// driver could not import it without pointing `driver/` at a CLI entry point, so the table had to be
// handed in as a PARAMETER by every caller. That was right while the only callers were the wizard and
// `bin/start.mjs`, which both hold it legitimately.
//
// A later change added a third and a fourth — the runner's intake wall and the intake doors — and
// neither is a CLI. Both would have had to dynamic-import a CLI entry point at call time to read a
// 44-line data table, and the cycle that trick avoids is not theoretical: a static import in that
// direction makes `clearotron doctor` exit 13 after printing most of a report, because onboard's
// top-level `await runCli()` never settles.
//
// So the table moves to where data belongs and the cycle stops existing. `bin/onboard.mjs` re-exports it
// under its own name, because this IS the wizard's selection list and many arms and call sites read
// `PROVIDERS` from there. Nothing about the table changed in the move; this is still its one definition.
//
// ── WHAT THIS TABLE IS, AND WHAT IT IS NOT ──────────────────────────────────────────────────────────
//
// The SELECTION table — what a person choosing a register is offered, keyed by the id that goes into
// `CLEAROTRON_DATABASE`. It is NOT `driver.config.mjs`'s adapter table of the same name, which is keyed
// differently and carries different fields. Confusing the two is how a credential set goes stale in the
// direction that passes, because the shorter list asks for less.
//
// `credentials` are BLOCKING for that register — a run cannot verify a registry citation without them.
// `optionalCredentials` narrow the offices reached, and the run DISCLOSES what it could not cover.
// `driver/run-requirements.mjs` derives from those two fields and never restates them.
//
// The vendor sign-up steps travel WITH the table rather than staying behind in the wizard: they are
// facts about the register, the wizard is one reader of them, and the same steps are asked for on the same
// steps on surfaces the wizard does not own.

// The USPTO sizing figures are MEASURED and live in their own module; the warnings below quote them
// rather than restating numbers that would go stale silently. Same import the wizard already had.
import {
  USPTO_ARCHIVE_GB, USPTO_INDEX_GB, USPTO_INGEST_GB_PER_HOUR, USPTO_DAILY_TOPUP_MB,
  usptoBuildHours, usptoProvisionGB,
} from "./uspto-index-size.mjs";

const SIGNA_SIGNUP = [
  "1. Create an account at https://signa.so/ and open the API section — it is self-serve: no sales",
  "   call, no contract, no waiting.",
  "2. Issue an API key and paste it here. See providers/README.md for the base-URL override.",
];

const EUIPO_SIGNUP = [
  "1. Sign in at https://euipo.europa.eu/ (create an account if you have none).",
  "2. Open the API portal and register an application for the trademark-search API.",
  "3. It issues a client id and a client secret. The secret is shown once.",
  "4. Ask for PRODUCTION access. The sandbox is a SEPARATE DEPLOYMENT holding a different corpus —",
  "   a sandbox credential searches marks that do not exist.",
];

const USPTO_WARNINGS = [
  "USPTO_LOCAL_DB is not an API key: it is a path to a database you build first.",
  "THE ONE-OFF COST, in full:",
  `  · ~${USPTO_ARCHIVE_GB} GB downloaded from the USPTO bulk products`,
  `  · ~${usptoBuildHours()} hours of ingest (measured ${USPTO_INGEST_GB_PER_HOUR} GB/h; yours scales with disk and CPU)`,
  `  · it settles to a ~${USPTO_INDEX_GB} GB index, then ~${USPTO_DAILY_TOPUP_MB} MB of nightly top-ups`,
  `  · provision ~${usptoProvisionGB()} GB free — the archives are deleted as they are ingested, so they never all exist at once`,
  "The EU register needs NONE of this and works as soon as your EUIPO credentials are in.",
  "A USPTO API key needs an ID.me identity verification, which is a real-world identity check.",
  "Build it with:  npm run sync:uspto      (resumable — an interrupted build picks up where it stopped)",
];



export const PROVIDERS = [
  {
    id: "signa", label: "Signa — recommended: US + EU + WIPO and eight more offices", cost: "subscription",
    covers: "the US and EU registers together, plus WIPO/Madrid, the UK, Switzerland, Canada, Australia, "
      + "France, Singapore, Norway and Sweden — eleven offices — with native sound-alike search, exact "
      + "result counts and opposition state. One self-serve key, no sales call.",
    credentials: ["SIGNA_API_KEY"],
    signup: SIGNA_SIGNUP,
  },
  {
    id: "free-tier", label: "Free tier — EU + US, no subscription", cost: "free",
    covers: "the EU register and the US register together, from two free sources composed into one. "
      + "Everywhere else is a disclosed gap.",
    credentials: ["EUIPO_CLIENT_ID", "EUIPO_CLIENT_SECRET"],
    // OPTIONAL, and that is the whole point of the free tier being reachable. Requiring the US
    // index here told a newcomer to build a 41.5 GB index over two bulk products before anything could
    // run — the first thing an open-source reader hits, on the configuration that exists precisely so a
    // clearance needs no subscription. Without it the US office is split off at plan compile and
    // disclosed as a deferred coverage row; the EU half runs.
    optionalCredentials: ["USPTO_LOCAL_DB"],
    extra: { EUIPO_ENVIRONMENT: "production" },
    signup: EUIPO_SIGNUP,
    warnings: USPTO_WARNINGS,
    validateEuipo: true,
    uspToLocalKey: "USPTO_LOCAL_DB",
  },
  {
    id: "euipo", label: "EUIPO — the EU register only", cost: "free",
    covers: "the EU register, and nothing else. Every other territory becomes a disclosed gap in the report.",
    credentials: ["EUIPO_CLIENT_ID", "EUIPO_CLIENT_SECRET"],
    extra: { EUIPO_ENVIRONMENT: "production" },
    signup: EUIPO_SIGNUP,
    validateEuipo: true,
  },
  {
    id: "uspto-local", label: "USPTO (local index) — the US register only", cost: "free",
    covers: "the US register, and nothing else, from an index you build and hold locally.",
    credentials: ["USPTO_LOCAL_DB"],
    warnings: USPTO_WARNINGS,
    uspToLocalKey: "USPTO_LOCAL_DB",
  },
  { id: "corsearch", label: "Corsearch — global", cost: "subscription", covers: "a global sweep.", credentials: ["CORSEARCH_SESSION_KEY"] },
  { id: "clarivate", label: "Clarivate — global", cost: "subscription", covers: "a global sweep.", credentials: ["CLARIVATE_API_KEY"] },
];
