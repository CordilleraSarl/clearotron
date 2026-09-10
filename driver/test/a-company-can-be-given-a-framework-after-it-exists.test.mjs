// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// — A COMPANY CREATED IN THE BROWSER CAN BE GIVEN A FRAMEWORK.
//
// The browser deliberately sets no framework: `frameworkPath` is code-owned, the profile screen shows it
// read-only, and expert settings stay on the command line by ruling. But the command line had one verb,
// `add`, which only creates — so a company made in the browser could not be pointed at a rubric by ANY
// supported route. The guide and the profile screen both name a route that did not exist.
//
// WHAT THIS FILE HOLDS. That the verb refuses before it writes, that a refusal leaves the company exactly
// as it was, and that it reuses the create path's own lint rather than a second opinion. The last is the
// one that rots: two checks means two sets of words to keep in step, and the one written here would be
// the one that goes stale.

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { framework } from "../../bin/brandowner.mjs";
import { Refusal } from "../../shared/onboarding-store.mjs";

const store = ({ pack = null } = {}) => {
  const d = mkdtempSync(join(tmpdir(), "fw-verb-"));
  writeFileSync(join(d, "acme.json"), JSON.stringify({ name: "Acme", platforms: ["amazon.com"] }, null, 2));
  if (pack !== null) writeFileSync(join(d, "acme.context.md"), pack);
  return d;
};
// The resolution shape the store guard accepts, same as the create verb's own arms use. Anything else
// is refused — correctly: it will not write into the demo roster bundled in the checkout.
const overlayOn = (dir) => ({ situation: "overlay", inForce: dir, store: dir, configured: dir });
const run = (dir, argv) => framework(argv, { resolution: overlayOn(dir), out: () => {} });

test("a company with no framework of its own is given one", async () => {
  const dir = store();
  const r = await run(dir, ["acme", "skills/prelim-search/risk-framework.md"]);
  assert.equal(r.written, true);
  const written = JSON.parse(readFileSync(join(dir, "acme.json"), "utf8"));
  assert.equal(written.frameworkPath, "skills/prelim-search/risk-framework.md",
    "the verb reported success and the bundle carries no framework path");
  assert.equal(written.name, "Acme", "the rest of the bundle did not survive the rewrite");
  assert.deepEqual(written.platforms, ["amazon.com"], "a field the verb does not own was lost");
});

test("a framework that does not resolve is REFUSED, and nothing is written", async () => {
  // The direction that matters. A company that already rates under something must not be left
  // half-changed, or rating silently moves under a path nobody can load.
  const dir = store();
  const before = readFileSync(join(dir, "acme.json"), "utf8");
  await assert.rejects(() => run(dir, ["acme", "skills/prelim-search/no-such-framework.md"]), Refusal);
  assert.equal(readFileSync(join(dir, "acme.json"), "utf8"), before,
    "a refused framework still rewrote the bundle — the company was left changed by a command that failed");
});

test("the shape check is the create path's, not a second one", async () => {
  // `resolveFramework` refuses an arbitrary path in the words the create path uses. If this verb ever
  // grows its own, the two will disagree about what a valid framework is.
  const dir = store();
  await assert.rejects(() => run(dir, ["acme", "/etc/passwd"]), (e) =>
    e instanceof Refusal && /skills\/prelim-search/.test(e.message));
  await assert.rejects(() => run(dir, ["acme", "skills/prelim-search/../../etc/passwd"]), Refusal);
});

test("an absent company is named rather than created", async () => {
  const dir = store();
  await assert.rejects(() => run(dir, ["nosuch", "skills/prelim-search/risk-framework.md"]), (e) =>
    e instanceof Refusal && /no company "nosuch"/.test(e.message));
  assert.equal(existsSync(join(dir, "nosuch.json")), false,
    "a typo created a bundle carrying nothing but a framework path");
});

test("setting the framework it already has changes nothing and says so", async () => {
  const dir = store();
  await run(dir, ["acme", "skills/prelim-search/risk-framework.md"]);
  const after = readFileSync(join(dir, "acme.json"), "utf8");
  const r = await run(dir, ["acme", "skills/prelim-search/risk-framework.md"]);
  assert.equal(r.written, false, "a no-op rewrote the bundle and spent an audit row on it");
  assert.equal(readFileSync(join(dir, "acme.json"), "utf8"), after);
});

test("the verb is reachable — it is in the usage and in the dispatch", async () => {
  // A verb the command does not route to is a function with a test. Both halves, because the usage is
  // what a person reads and the dispatch is what runs.
  const src = readFileSync(new URL("../../bin/brandowner.mjs", import.meta.url), "utf8");
  assert.match(src, /brandowner framework <key> <path>/, "the usage does not mention the verb");
  assert.match(src, /sub === "framework"/, "nothing dispatches to the verb");
  assert.match(src, /One of: add, framework/, "the no-such-action message still lists only add");
});

// — THE COMPANY'S CONTEXT PACK SURVIVES.
//
// Found in review, not by this file, and the reason this file could not see it is worth keeping: every
// fixture above writes a store with no `acme.context.md`, so the branch that removes one was never
// reachable. `defaultWriteProfile` reads an absent `contextPack` as "this company has none" and DELETES
// the sibling file. `add` always passes the pack it was given, so it never met that branch; this verb is
// the first caller that rewrites a company which already exists.
//
// A company's context pack is prose somebody wrote about that business. Losing it while setting a
// framework is silent — the verb reports the framework it set, the removal goes into the same commit
// under a message about the framework, and nothing on any screen says the pack is gone.
test("setting a framework leaves the company's context pack exactly as it was", async () => {
  const prose = "Acme sells industrial fasteners.\nIts marks are used on packaging, not on the parts.\n";
  const dir = store({ pack: prose });
  const r = await run(dir, ["acme", "skills/prelim-search/risk-framework.md"]);
  assert.equal(r.written, true);
  assert.equal(existsSync(join(dir, "acme.context.md")), true,
    "the context pack was deleted by a command that only sets a framework");
  assert.equal(readFileSync(join(dir, "acme.context.md"), "utf8"), prose,
    "the context pack survived but its contents were rewritten");
});

// The other direction, so the arm above cannot pass by the verb simply never writing. A company that
// never had a pack must not acquire an empty one.
test("a company with no context pack is not given one", async () => {
  const dir = store();
  await run(dir, ["acme", "skills/prelim-search/risk-framework.md"]);
  assert.equal(existsSync(join(dir, "acme.context.md")), false,
    "the verb created a context pack for a company that had none");
});
