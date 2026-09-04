#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// Emits the portal's generated design-token stylesheet from shared/portal-tokens.mjs (which in turn reads
// shared/brand.mjs). Run it after any colour change:
//
//   node shared/tools/emit-tokens.mjs            write portal-ui/src/tokens.css
//   node shared/tools/emit-tokens.mjs --check    verify, exit 1 with a diff hint  (CI)
//
// IT EMITTED A SECOND FILE UNTIL — portal-ui/src/brand-art.ts, the ridge mark as path data for a
// component that had already stopped drawing. The generator, its staleness check and the module
// went together: a generated file whose only reader is deleted is a build step that can only fail.
//
// --check also asserts that portal-ui/index.html carries the pre-paint theme script VERBATIM. That script
// is inline (it has to run before first paint, or a dark-mode user gets a white flash), so the SPA's CSP
// admits it by `'sha256-…'` rather than by opening `'unsafe-inline'`. portal-service computes that hash
// at runtime from the same exported constant — meaning there is exactly one copy of the script text in
// the system, and this check is what proves index.html has not drifted from it. If they ever disagree,
// the CSP silently blocks the script and the portal first-paints light for everyone who chose dark.

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { portalTokensCss, PRE_PAINT_SCRIPT, PORTAL_TOKENS } from "../portal-tokens.mjs";

const at = (p) => fileURLToPath(new URL(p, import.meta.url));
const CSS_PATH = at("../../portal-ui/src/tokens.css");
const HTML_PATH = at("../../portal-ui/index.html");
const BUILT_HTML_PATH = at("../../portal-ui/dist/index.html");

const check = process.argv.includes("--check");
const css = portalTokensCss();

const read = (p) => {
  try {
    return readFileSync(p, "utf8");
  } catch {
    return null;
  }
};

let failed = false;
const fail = (msg) => {
  console.error(`✗ ${msg}`);
  failed = true;
};

if (check) {
  const onDisk = read(CSS_PATH);
  if (onDisk === null) fail("portal-ui/src/tokens.css is missing — run: node shared/tools/emit-tokens.mjs");
  else if (onDisk !== css) {
    fail(
      "portal-ui/src/tokens.css is stale — a brand colour changed but the stylesheet was not regenerated.\n"
      + "  Run: node shared/tools/emit-tokens.mjs",
    );
    // Show the first differing line; a full diff of 80 near-identical lines helps nobody.
    const a = onDisk.split("\n"), b = css.split("\n");
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      if (a[i] !== b[i]) {
        console.error(`  first difference, line ${i + 1}:\n    on disk:  ${a[i] ?? "(end of file)"}\n    expected: ${b[i] ?? "(end of file)"}`);
        break;
      }
    }
  }

  const html = read(HTML_PATH);
  if (html === null) fail("portal-ui/index.html is missing");
  else if (!html.includes(PRE_PAINT_SCRIPT)) {
    fail(
      "portal-ui/index.html does not contain the pre-paint theme script verbatim.\n"
      + "  The CSP admits that script by hash, so any edit to it silently breaks first-paint theming.\n"
      + "  Paste this exact string back into the inline <script> in index.html:\n"
      + `    ${PRE_PAINT_SCRIPT}`,
    );
  }

  // And again against the BUILT file, which is what actually ships and what the browser actually
  // hashes. The source check above catches someone editing the script by hand; this one catches the
  // build transforming it — today it survives only because vite.config sets minify:false, and a future
  // minify:true would rewrite the script, break the hash, and produce a failure with no symptom except
  // that every dark-mode user first-paints light and a CSP violation lands in a console nobody reads.
  const built = read(BUILT_HTML_PATH);
  if (built === null) {
    console.warn("  (no built bundle yet — skipping the built-output check; it runs after `npm run build:ui`)");
  } else if (!built.includes(PRE_PAINT_SCRIPT)) {
    fail(
      "portal-ui/dist/index.html does not carry the pre-paint script verbatim — THE BUILD CHANGED IT.\n"
      + "  The CSP hash is computed from the source constant, so the shipped script would be blocked.\n"
      + "  The usual cause is minification: vite.config.ts sets build.minify=false partly for this reason.\n"
      + "  Either keep the script byte-stable through the build, or switch the CSP to a nonce.",
    );
  }

  if (!failed) {
    const sha = createHash("sha256").update(PRE_PAINT_SCRIPT).digest("base64");
    console.log(`✓ ${PORTAL_TOKENS.length} tokens up to date; pre-paint script pinned as 'sha256-${sha}'`);
  }
  process.exit(failed ? 1 : 0);
}

writeFileSync(CSS_PATH, css);
console.log(`wrote portal-ui/src/tokens.css — ${PORTAL_TOKENS.length} tokens, light + dark`);
