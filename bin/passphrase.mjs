#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// clearotron passphrase — report or reset the local portal sign-in.
//
// ── WHY THIS VERB EXISTS ────────────────────────────────────────────────────────────────────
//
// The portal mints its passphrase once, on first start, and prints it to that start's terminal. On a
// supervised install — `clearotron start` under a unit, which is what the documented install produces —
// that terminal belongs to the installing process and the operator never sees it. The credential on
// disk is a scrypt digest, so the passphrase cannot be read back from it.
//
// The documented recovery was "delete ~/.cordillera/portal-local-credential.json and restart", which
// appeared in docs/PORTAL.md and nowhere a locked-out operator would look: not on the login page, not
// in any verb, not in `--help`. An operator holding the box and not that terminal was locked out
// permanently by a product that had the means to let them in.
//
// THE MINT-ONCE POSTURE IS UNCHANGED. `establishCredential` still writes with `flag: "wx"` and still
// refuses to overwrite. What this verb adds is the operator's deliberate act — remove, then mint —
// as a command that says what it did, instead of a file path they had to already know.
//
// ── WHAT IT DOES NOT DO ─────────────────────────────────────────────────────────────────────────────
//
// It never prints an existing passphrase, because nothing can: the record is a digest. Without --reset
// it reports only WHERE the credential is, WHETHER it exists and WHOSE address it carries — three
// facts an operator needs and none of them a secret.

import { existsSync, rmSync } from "node:fs";
import { credentialPathFor, establishCredential, readLocalCredential } from "../driver/portal-local-auth.mjs";
// — the form a reader can actually type, derived from how THIS process started
// rather than hardcoded. A hardcoded `npx ` tells a global installer their install is somehow lesser;
// a hardcoded bare name sends an npx reader to `command not found`.
import { invocationPrefix } from "../shared/invocation.mjs";

const P = invocationPrefix();
const USAGE = `  ${P}clearotron passphrase — report or reset the portal's local sign-in

    ${P}clearotron passphrase           where the credential is, whether it exists, whose it is
    ${P}clearotron passphrase --reset   mint a NEW passphrase and print it once
    ${P}clearotron passphrase --help    this text. Changes nothing.

  A reset invalidates the current passphrase immediately. Anyone signed in keeps their session until
  it expires; the old passphrase stops working the moment the new one is written.`;

const args = process.argv.slice(2);
if (args.includes("--help") || args.includes("-h")) { console.log(`\n${USAGE}\n`); process.exit(0); }

const path = credentialPathFor();
const reset = args.includes("--reset");
const unknown = args.filter((a) => !["--reset", "--help", "-h"].includes(a));
if (unknown.length) {
  console.error(`clearotron passphrase: unrecognised argument${unknown.length > 1 ? "s" : ""} ${unknown.join(", ")}\n\n${USAGE}\n`);
  process.exit(2);
}

// The address the credential carries is the identity the session rides on. On a reset we keep the
// EXISTING record's address rather than re-reading PORTAL_LOCAL_USER: if the two have drifted, minting
// against the env value would hand the operator a passphrase for an address the portal then refuses,
// and the portal's own startup check would call it a FATAL mismatch. Only a first mint falls back to
// the env, because then there is no record to be faithful to.
let existing = null;
try { existing = existsSync(path) ? readLocalCredential(path) : null; }
catch (e) {
  // A credential that exists and cannot be read is not "no credential". Say so, and do not offer to
  // mint over it — that is the one action that could destroy a working sign-in.
  console.error(`clearotron passphrase: the credential at ${path} could not be read — ${String(e?.message ?? e)}`);
  console.error("  This is not the same as having no credential, so nothing has been changed. Fix or move the file, then re-run.");
  process.exit(1);
}

if (!reset) {
  console.log(`\n  credential: ${path}`);
  console.log(existing
    ? `  exists:     yes — for ${existing.email}, created ${existing.createdAt ?? "(no date recorded)"}`
    : `  exists:     NO — the portal will mint one on its next start and print it to that start's output`);
  console.log(existing
    ? `\n  The passphrase itself cannot be shown: what is stored is a digest, not the secret.\n  To get a working one, run:  ${P}clearotron passphrase --reset\n`
    : `\n  Nothing to reset yet.\n`);
  process.exit(0);
}

const email = existing?.email || process.env.PORTAL_LOCAL_USER || "";
if (!email) {
  console.error("clearotron passphrase --reset: no credential exists yet and PORTAL_LOCAL_USER is unset, so there is no");
  console.error("  address to mint against. Set PORTAL_LOCAL_USER, or start the portal once and let it mint.");
  process.exit(1);
}

// Remove, then mint. Deliberately not an overwrite flag on establishCredential: the refusal to
// overwrite is what protects a working credential from every OTHER caller, and weakening it here would
// weaken it everywhere. The operator's intent is expressed by running this verb, not by a mode bit.
if (existing) rmSync(path);
let minted;
try { minted = establishCredential({ path, email }); }
catch (e) {
  console.error(`clearotron passphrase --reset: could not write ${path} — ${String(e?.message ?? e)}`);
  process.exit(1);
}

console.log(`\n  A NEW passphrase has been minted for ${email}.`);
console.log(`  The previous one no longer works.\n`);
console.log(`  PASSPHRASE: ${minted.passphrase}\n`);
console.log(`  Write it down now. It is stored only as a digest, so this line is the only copy that will`);
console.log(`  ever exist — re-run this command if you lose it.\n`);
