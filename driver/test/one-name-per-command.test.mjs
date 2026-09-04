// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// ONE NAME PER COMMAND, IN EVERY DOCUMENT A USER READS —.
//
// Three actions had three names each when this landed. The wizard was `npm run setup` in six documents
// and `npx clearotron install` in two. The demo was `npm run example`, `npm run demo` AND
// `npx clearotron demo`. The product was `npm start` in eight documents and `npx clearotron start` in one.
//
// This is not a style rule. **`npm run` is not a name the reader can use.** Someone who installed from
// the registry has no package scripts at all, so those documents named a command that does not exist
// for the reader most likely to be following them — the same defect the README carried in its
// quickstart, one layer down. `the-readmes-commands-run-as-written.test.mjs` catches it in the ROOT
// documents only; everything under docs/ and providers/ was unguarded, which is where it accumulated.
//
// ── THE EXCEPTION, AND WHY IT IS A LIST AND NOT A PATTERN ────────────────────────────────────────────
//
// Three documents keep the npm form on purpose, because their reader is already standing in the tree
// and the package script is the right thing to tell them. They are NAMED rather than matched, because
// every rule that tried to describe them by shape ("anything under bin/", "anything a contributor
// reads") also covered documents where the drift is the defect.
//
// bin/README.md is the mapping between the two names and necessarily prints both.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { trackedFiles, skipReason } from "../../shared/tracked-files.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const GUARD = "one-name-per-command (tracker issue 2131)";

/** Documents whose reader is in the checkout, so the package script IS the right name for them. */
const CHECKOUT_DOCS = new Set(["AGENTS.md", "bin/README.md", "driver/engine/README.md"]);

/** The product's own verbs, spelled as package scripts. Each has a `clearotron` verb that ships. */
const CHECKOUT_ONLY = [
  [/\bnpm start\b/, "npx clearotron start"],
  [/\bnpm run setup\b/, "npx clearotron install"],
  [/\bnpm run example\b/, "npx clearotron demo"],
  [/\bnpm run demo\b/, "npx clearotron demo"],
];

const read = (rel) => readFileSync(join(ROOT, rel), "utf8");

test("no user-facing document names a command that only exists in a checkout", (ctx) => {
  const tracked = trackedFiles(GUARD, { root: ROOT });
  if (!tracked) return ctx.skip(skipReason(GUARD));
  const docs = tracked.filter((f) => f.endsWith(".md")
    && !CHECKOUT_DOCS.has(f)
    && !f.startsWith("driver/test/")
    && !f.startsWith("driver/skills/"));

  // ANTI-VACUITY. A filter that selected nothing would pass this file forever. The shipped verb must
  // be present in quantity before the absence of the npm form means anything.
  const shipped = docs.filter((f) => /npx clearotron [a-z]/.test(read(f)));
  assert.ok(shipped.length >= 8,
    `only ${shipped.length} document(s) use the shipped verb — this scan is reading almost nothing, `
    + "so the assertion below would be free");

  const offenders = [];
  for (const f of docs) {
    const lines = read(f).split("\n");
    lines.forEach((line, i) => {
      for (const [form, instead] of CHECKOUT_ONLY) {
        if (form.test(line)) offenders.push(`${f}:${i + 1} — write \`${instead}\``);
      }
    });
  }
  assert.deepEqual(offenders, [],
    `a reader who installed from the registry has no package scripts, so these name a command they `
    + `cannot run:\n  ${offenders.join("\n  ")}`);
});

test("the checkout documents that keep the npm form still carry it — the exception is not a dead letter", (ctx) => {
  const tracked = trackedFiles(GUARD, { root: ROOT });
  if (!tracked) return ctx.skip(skipReason(GUARD));
  // A CONTROL. If these were rewritten to the shipped verb, the exception list above would be
  // excluding nothing and this file would quietly stop testing what it claims to.
  for (const f of CHECKOUT_DOCS) {
    assert.ok(tracked.includes(f), `${f} is named as an exception and is not tracked — retire the entry`);
    assert.ok(CHECKOUT_ONLY.some(([form]) => form.test(read(f))),
      `${f} is declared as keeping the npm form and no longer uses one. Either it moved to the shipped `
      + "verb, in which case remove it from CHECKOUT_DOCS, or the exception is now excluding nothing.");
  }
});
