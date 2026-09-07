// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// `demo --help` listed --run-dir, --base, --port and --no-open, and stopped.
//
// `demo/` ships one frozen run per product. `--product` selects one, and the help never mentioned it, so
// three of the four shipped demos were reachable only by typing the flag wrong and reading the refusal.
// Driven as a stranger against published 0.1.4: all four run and render reports whose titles name the
// product. They worked; they were unfindable from the command written to give somebody a first look.
//
// THE ARM IS AGREEMENT WITH THE CONTAINER, not the presence of four names. A hardcoded list would pass
// this file and go stale the day a fifth demo lands — which is the same defect one turn later.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync, mkdtempSync, copyFileSync, symlinkSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { demoChildren } from "../demo-container.mjs";

const ROOT = join(dirname(dirname(fileURLToPath(import.meta.url))), "..");
const DEMO = join(ROOT, "bin", "example.mjs");
const DEMO_ROOT = join(ROOT, "demo");

const help = () => {
  const r = spawnSync(process.execPath, [DEMO, "--help"], { encoding: "utf8", timeout: 60_000 });
  return `${r.stdout ?? ""}${r.stderr ?? ""}`;
};

test("201 the help names the --product flag at all", () => {
  const out = help();
  assert.match(out, /--product/,
    `demo --help does not mention --product, so the other demos are discoverable only by error:\n${out}`);
});

test("201 the help names EVERY product this tree ships, read off the container", () => {
  const shipped = demoChildren(DEMO_ROOT);
  assert.ok(shipped.length >= 2,
    `this tree ships ${shipped.length} demo(s), so an arm about listing several cannot look here`);
  const out = help();
  const missing = shipped.filter((id) => !out.includes(id));
  assert.deepEqual(missing, [],
    `demo --help ships these products and does not name them: ${missing.join(", ")}\n${out}`);
});

// THIS ARM ASSERTED THE OPPOSITE UNTIL TODAY, and its premise is what changed. It required the help to
// name which single product a bare `demo` replayed, "because it picks one silently". A bare `demo` now
// publishes every product the package ships, so a help text naming a default would teach the belief the
// change removed — and it did: the line survived the behaviour change and told a reader on the shipped
// release that one product was what they got with no flag.
test("201 the help says a bare `demo` publishes every product, because that is what it does", () => {
  const shipped = demoChildren(DEMO_ROOT);
  const out = help();
  assert.ok(!/\(the default, when --product is not given\)/.test(out),
    `the help still names one product as the default. A bare \`demo\` publishes all ${shipped.length} of `
    + `them, so this sends a reader away believing they got one:\n${out}`);
  assert.match(out, /With no --product, every one of them is published\./,
    `the help lists the products and never says what happens without the flag:\n${out}`);
});

// THE PLANT THAT MATTERS, run every time rather than by hand: a product that arrives tomorrow must
// appear without anyone editing the help. This is the whole reason the list is derived.
//
// IT DRIVES A TREE OF ITS OWN, and that is not tidiness. The first version planted its product in the
// real `demo/` and swept up afterwards. Test FILES run concurrently against one working tree, so for as
// long as that directory existed every other file walking `demo/` — the container arms, the packaging
// arms — could see a product that is not a product, and the red would surface somewhere else, in
// another file, intermittently. `example.mjs` derives its repo root from its own location, so a COPY of
// it in a temp tree reads that tree's `demo/`; `driver` and `shared` are symlinked back, because the
// modules behind them are the same code either way.
test("201 a product added to the container appears in the help with no edit to it", () => {
  const tmp = mkdtempSync(join(tmpdir(), "ct201-"));
  try {
    mkdirSync(join(tmp, "bin"), { recursive: true });
    copyFileSync(DEMO, join(tmp, "bin", "example.mjs"));
    for (const d of ["driver", "shared", "node_modules"]) {
      try { symlinkSync(join(ROOT, d), join(tmp, d), "dir"); } catch { /* absent is the next line's finding */ }
    }
    copyFileSync(join(ROOT, "package.json"), join(tmp, "package.json"));
    // Two products this repository does not ship, so nothing here can pass by naming a real one.
    const planted = ["aa-arm-product-one", "zz-arm-product-two"];
    for (const id of planted) {
      mkdirSync(join(tmp, "demo", id, "run"), { recursive: true });
      writeFileSync(join(tmp, "demo", id, "meta.json"), JSON.stringify({ product: id }, null, 2));
      writeFileSync(join(tmp, "demo", id, "run", "report.md"), "# planted by an arm, not a demo\n");
    }
    assert.deepEqual(demoChildren(join(tmp, "demo")), planted, "the planted container is not what this arm built");

    const r = spawnSync(process.execPath, [join(tmp, "bin", "example.mjs"), "--help"],
      { encoding: "utf8", timeout: 60_000 });
    const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
    assert.doesNotMatch(out, /knockout-search/,
      `the copy read the REAL demo/ instead of its own, so this arm proves nothing:\n${out}`);
    for (const id of planted) {
      assert.match(out, new RegExp(id),
        `a product under this tree's demo/ did not reach --help, so the list is hardcoded somewhere:\n${out}`);
    }
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});
