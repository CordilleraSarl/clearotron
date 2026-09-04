#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// DOES THE BROWSER ACCEPT THE SANDBOX WE THINK WE WROTE? Ask it, not a regex.
//
//   node scripts/report-frame-check.mjs
//
// is entirely about a sandbox token list. Counsel saw two symptoms in delivered reports — a link
// that opens in the report's own window and fails, and a link that renders and does nothing when
// clicked — and both are the frame refusing something the anchor asked for.
//
// A STRING TEST CANNOT SEE THE FAILURE THIS EXISTS FOR. `sandbox` is a DOMTokenList: a browser silently
// DROPS a token it does not recognise. `allow-popups-to-escape-sandbox` misspelled by one character
// leaves an attribute that greps clean, renders without error, and quietly restores exactly the bug
// fixed. The only thing that knows which tokens survived is the browser, and asking it is one
// measurement.
//
// It also asserts the token that must be ABSENT. `allow-same-origin` is what retires the stored-XSS
// class for every report ever delivered (reportFrame.ts); a future widening that adds it to make some
// link work would pass every unit test in this repo.
//
// Needs `google-chrome` (on the VM). Same mechanism as render-check.mjs: a page computes its verdict
// and writes it into <title>, which --dump-dom hands back.

import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { isEntrypoint } from "../shared/is-entrypoint.mjs";   // — one entry-point test, all spellings

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** The sandbox the portal actually ships, read from the source that ships it. PURE. */
export function shippedSandbox(src) {
  const m = /sandbox="([^"]+)"/.exec(String(src ?? ""));
  return m ? m[1].trim().split(/\s+/).filter(Boolean) : [];
}

export const REQUIRED = ["allow-scripts", "allow-popups", "allow-popups-to-escape-sandbox"];
export const FORBIDDEN = ["allow-same-origin", "allow-top-navigation"];

function main() {
  const src = readFileSync(join(ROOT, "portal-ui", "src", "screens", "Result.tsx"), "utf8");
  const tokens = shippedSandbox(src);
  if (!tokens.length) { console.log("FAILED — no sandbox attribute found in Result.tsx"); process.exit(1); }
  console.log(`shipped sandbox: ${tokens.join(" ")}`);

  const work = mkdtempSync(join(tmpdir(), "frame-check-"));
  try {
    // The page builds the frame with the SHIPPED string and reports what the browser kept.
    writeFileSync(join(work, "verify.html"), `<!doctype html><title>pending</title><body>
<script>
  const f = document.createElement('iframe');
  f.setAttribute('sandbox', ${JSON.stringify(tokens.join(" "))});
  document.body.appendChild(f);
  const kept = [...f.sandbox];
  document.title = JSON.stringify({ kept });
</script></body>`);
    const out = execFileSync("google-chrome", [
      "--headless=new", "--disable-gpu", "--no-sandbox",
      `--user-data-dir=${join(work, "prof")}`,
      "--virtual-time-budget=8000", "--dump-dom", `file://${join(work, "verify.html")}`,
    ], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 120000 });

    const m = /<title>(.*?)<\/title>/s.exec(out);
    if (!m || m[1] === "pending") { console.log("FAILED — the page never reported"); process.exit(1); }
    const kept = JSON.parse(m[1]).kept;
    console.log(`browser kept:    ${kept.join(" ")}`);

    let bad = 0;
    for (const t of REQUIRED) {
      const ok = kept.includes(t);
      console.log(`  ${ok ? "ok  " : "FAIL"} required  ${t}`);
      if (!ok) bad++;
    }
    for (const t of FORBIDDEN) {
      const ok = !kept.includes(t);
      console.log(`  ${ok ? "ok  " : "FAIL"} forbidden ${t}`);
      if (!ok) bad++;
    }
    const dropped = tokens.filter((t) => !kept.includes(t));
    if (dropped.length) { console.log(`  FAIL the browser DROPPED ${dropped.join(", ")} — misspelled or unsupported`); bad++; }
    console.log(bad ? `\n${bad} problem(s)` : "\nthe browser accepts exactly the boundary we wrote");
    process.exit(bad ? 1 : 0);
  } finally { rmSync(work, { recursive: true, force: true }); }
}

if (isEntrypoint(import.meta.url)) main();
