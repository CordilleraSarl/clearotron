// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// release-visible-check.mjs — can a stranger's npm client get the version this run just published?
//
//   node scripts/release-visible-check.mjs --version <v> --tag <dist-tag> --tarball <file>
//        [--timeout 900] [--interval 15] [--registry https://registry.npmjs.org] [--name clearotron]
//
// Exit 0: the registry serves <v>, the <dist-tag> names it, and the tarball it serves is byte for byte
// the one at <file> — the bytes this run published. Exit 1: not served within the bound, which is PENDING:
// npm accepts a publish before it serves it. Exit 3: the registry serves DIFFERENT BYTES for <v>, which is
// never pending and must go red at once, so it has a code of its own; it used to share 1, and a caller
// that waits on 1 then waited six hours on a wrong tarball. Exit 2: could not look — bad arguments, or the
// local tarball cannot be read. In every case but 0 the caller creates no release entry.
//
// ── WHY THIS RUNS BEFORE THE RELEASE ENTRY ─────────────────────────────────────────────────────────
//
// `npm publish` returning is the registry accepting the upload, not the registry serving it. Measured on
// 0.3.2-beta.10, 2026-09-18: the release entry went up at 19:47:40Z and the workflow finished three
// seconds later, while an unauthenticated `npm view clearotron@0.3.2-beta.10` answered E404 and the beta
// tag still named beta.9 until about 19:56Z. Nine minutes in which the releases page named a version
// nobody could install, and a green run reported it done on evidence no user could see. So the entry
// waits for the registry to answer a stranger, and a registry that never does leaves no entry at all.
//
// ── UNAUTHENTICATED ON PURPOSE ──────────────────────────────────────────────────────────────────────
//
// Plain requests with no credential and no npm configuration. The publishing job holds a publish
// credential, and a read made with it can see what the public cannot yet — which is the gap this
// exists to close. No cache-busting query either: a stranger's client does not add one.
//
// ── AND THE BYTES, NOT ONLY THE NAME ────────────────────────────────────────────────────────────────
//
// A version document can answer while the tarball behind it is not the one this run built. So the
// tarball the registry serves is fetched, as `npm pack <name>@<version>` would fetch it, and its sha512
// is compared both with the registry's own recorded integrity and with the local file this run
// uploaded. Either disagreeing is a refusal, not a warning.
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { isEntrypoint } from "../shared/is-entrypoint.mjs";

const arg = (argv, flag, dflt = null) => { const i = argv.indexOf(flag); return i === -1 ? dflt : argv[i + 1]; };
const sri = (bytes) => `sha512-${createHash("sha512").update(bytes).digest("base64")}`;
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));

/** One look at the registry, as a stranger. Returns what it served and nothing it did not. */
export async function lookOnce({ registry, name, version, tag }) {
  const seen = { version: null, tagged: null, integrity: null, tarball: null, error: null };
  try {
    const v = await fetch(`${registry}/${encodeURIComponent(name)}/${encodeURIComponent(version)}`, { headers: { accept: "application/json" } });
    if (v.ok) {
      const doc = await v.json();
      seen.version = doc.version ?? null;
      seen.integrity = doc.dist?.integrity ?? null;
      seen.tarball = doc.dist?.tarball ?? null;
    }
    const t = await fetch(`${registry}/-/package/${encodeURIComponent(name)}/dist-tags`, { headers: { accept: "application/json" } });
    if (t.ok) seen.tagged = (await t.json())?.[tag] ?? null;
  } catch (e) { seen.error = String(e?.message ?? e); }
  return seen;
}

/** PURE. Is what a look saw the published version, under its tag? */
export function visible(seen, { version }) {
  return seen.version === version && seen.tagged === version && typeof seen.tarball === "string";
}

async function main() {
  const argv = process.argv.slice(2);
  const version = arg(argv, "--version"), tag = arg(argv, "--tag"), tarballPath = arg(argv, "--tarball");
  const registry = String(arg(argv, "--registry", "https://registry.npmjs.org")).replace(/\/+$/, "");
  const name = arg(argv, "--name", "clearotron");
  const timeoutSec = Number(arg(argv, "--timeout", "900")), intervalSec = Number(arg(argv, "--interval", "15"));
  if (!version || !tag || !tarballPath || !Number.isFinite(timeoutSec) || !Number.isFinite(intervalSec) || intervalSec <= 0) {
    console.error("release-visible-check: needs --version, --tag and --tarball, and a positive --interval. Could not look.");
    process.exit(2);
  }
  let local;
  try { local = sri(readFileSync(tarballPath)); }
  catch (e) { console.error(`release-visible-check: cannot read the published tarball ${tarballPath}: ${e.message}. Could not look.`); process.exit(2); }

  const started = Date.now(), deadline = started + timeoutSec * 1000;
  const epoch = () => Math.floor(Date.now() / 1000);
  let seen;
  for (;;) {
    seen = await lookOnce({ registry, name, version, tag });
    const waited = Math.round((Date.now() - started) / 1000);
    console.log(`release-visible-check: at ${epoch()} (+${waited}s) the registry answers ${name}@${version} → `
      + `${seen.version ?? "nothing"}; ${tag} → ${seen.tagged ?? "nothing"}${seen.error ? ` (${seen.error})` : ""}`);
    if (visible(seen, { version })) break;
    if (Date.now() + intervalSec * 1000 > deadline) {
      console.error(`\nrelease-visible-check: after ${waited}s an unauthenticated client still cannot get ${name}@${version} `
        + `under \`${tag}\`. The publish was accepted and is not yet served, so no release entry is created: `
        + "the page would name a version nobody can install. The tag is already written, so the pipeline "
        + "knows this version is published; the scheduled entry job creates the entry once the registry serves it.");
      process.exit(1);
    }
    await sleep(intervalSec * 1000);
  }

  let served;
  try {
    const r = await fetch(seen.tarball);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    served = sri(Buffer.from(await r.arrayBuffer()));
  } catch (e) {
    console.error(`release-visible-check: the registry names ${seen.tarball} and it could not be fetched: ${e.message}. No release entry.`);
    process.exit(1);
  }
  if (served !== local || (seen.integrity && seen.integrity !== local)) {
    console.error(`release-visible-check: the registry serves DIFFERENT BYTES for ${name}@${version}.\n`
      + `  published by this run: ${local}\n  served:                ${served}\n  recorded integrity:    ${seen.integrity ?? "none"}\n`
      + "No release entry is created for a version whose install is not the build this run verified.");
    process.exit(3);
  }
  console.log(`release-visible-check: a stranger can install ${name}@${version} under \`${tag}\`, `
    + `and the tarball served is the one this run published (${served.slice(0, 22)}…).`);
}

if (isEntrypoint(import.meta.url)) main();
