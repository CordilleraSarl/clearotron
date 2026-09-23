// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// THE DEMO OFFERS NO BACKGROUND FORM, AND AN INSTALL'S OFFER NAMES WHAT IT NEEDS.
//
// On a published beta (2026-09-11) the demo's closing lines offered `start --background` as "same
// product". Run as printed, it set up a new, empty install in the reader's home — not the demo, its
// samples or its sign-in — and then failed where the user's systemd was not reachable.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { backgroundOfferLines } from "../../bin/start.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

test("a demo is offered no background command", () => {
  const lines = backgroundOfferLines({ demo: true, manager: "systemd", start: "clearotron start" });
  assert.ok(lines.length > 0, "the demo still says how it runs");
  assert.ok(lines.every((l) => !l.includes("--background")), `a demo line offers --background: ${lines.join(" / ")}`);
  assert.match(lines.join(" "), /no background form/);
});

test("an install is offered it, with the prerequisite named in the same breath", () => {
  const lines = backgroundOfferLines({ demo: false, manager: "systemd", start: "clearotron start" });
  const text = lines.join(" ");
  assert.match(text, /clearotron start --background/);
  assert.match(text, /user manager/, "what --background needs is said before the reader stops the foreground product");
  // THE CONTROL: a platform with no background mechanism is offered nothing.
  assert.ok(backgroundOfferLines({ demo: false, manager: null }).every((l) => !l.includes("--background")));
});

test("the banner takes its offer from that one function", () => {
  const src = readFileSync(join(ROOT, "bin", "start.mjs"), "utf8");
  // PINNED TO THE CALL, NOT TO ITS ARGUMENT LIST. The old spelling named every argument in order, so
  // adding one — `keep`, when the demo learned to clean up after itself — reddened this arm for a
  // change that could not affect the property it is named for. What matters is that the banner asks
  // this function and hands it the two things only the banner knows.
  assert.match(src, /backgroundOfferLines\(\{[^}]*demo: DEMO[^}]*manager: backgroundManager\(\)[^}]*\}\)/,
    "the banner no longer takes its offer from the one function that composes it");
  assert.doesNotMatch(src, /To get your prompt back instead, stop this and run  \$\{invoke\("start"\)\} --background`\);\n\s*say/,
    "a second, unconditional copy of the offer is back in the banner");
});

test("`start --demo --background` is refused before anything is written", () => {
  const home = mkdtempSync(join(tmpdir(), "demo-bg-home-"));
  try {
    const r = spawnSync(process.execPath, [join(ROOT, "bin", "start.mjs"), "--demo", "--background"], {
      encoding: "utf8", cwd: ROOT, timeout: 60000,
      env: { PATH: process.env.PATH, HOME: home, USERPROFILE: home, CLEAROTRON_NO_ENV_FILE: "1" },
    });
    assert.notEqual(r.status, 0, `it did not refuse: ${r.stdout}\n${r.stderr}`);
    assert.match(`${r.stdout}\n${r.stderr}`, /the demo has no background form/);
    assert.ok(!existsSync(join(home, "trademark")), "an install was set up in the reader's home");
    assert.ok(!existsSync(join(home, ".config", "clearotron", ".env")), "a settings file was written");
    assert.ok(!existsSync(join(home, ".config", "systemd")), "a unit was written");
    assert.ok(readdirSync(home).every((n) => n.startsWith(".")) , `something was created in the home: ${readdirSync(home).join(", ")}`);
  } finally { rmSync(home, { recursive: true, force: true }); }
});

// ── THE DEMO SAYS WHAT HAPPENS TO ITS FOLDER, BEFORE THE READER DECIDES ──────────────────────────
//
// The demo removes what it created when its window closes (owner ruling, 2026-09-14), and a reader
// deciding whether to close the window is deciding whether to keep the reports. Finding that out from
// the last line is too late, so the offer says it while the terminal is still open — and says the
// opposite, correctly, for a run that was told to keep the folder.
test("the demo's offer says whether the folder survives the window, and names the flag that changes it", () => {
  const goes = backgroundOfferLines({ demo: true, keep: false }).join("\n");
  assert.match(goes, /goes when this window closes/, "a reader must know the reports are not kept before they close it");
  assert.match(goes, /--keep/, "and the one flag that changes it");

  const kept = backgroundOfferLines({ demo: true, keep: true }).join("\n");
  assert.match(kept, /keeps its folder/, "a run told to keep it must not warn that everything goes");
  assert.doesNotMatch(kept, /goes when this window closes/, "the two states must not print the same sentence");

  // THE CONTROL: this is a demo sentence and belongs to no other start.
  assert.ok(backgroundOfferLines({ demo: false, manager: "systemd" }).every((l) => !l.includes("--keep")));
});
