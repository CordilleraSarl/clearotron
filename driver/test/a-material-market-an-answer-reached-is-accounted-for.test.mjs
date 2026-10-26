// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A MATERIAL MARKET AN ANSWER REACHED IS ACCOUNTED FOR.
//
// The frame's material markets were read as a search and coverage duty per market: the digest called every material
// market without its own enumerated block an unsearched dangerous slice, the write-up's coverage judgment counted
// a material market's unfinished band as a material gap, and the frame's manual said its scope set drives one
// question per market. The ruled method asks a crowd's markets from the one list the opening message names, and a
// worldwide answer or a narrowed list that was read accounts for the markets it covers. This holds the ruled wording
// and that the old is gone. Every mark here is invented.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { paths, STAGES, REGISTER_AXES } from "../stages.mjs";

const SKILLS = join(dirname(fileURLToPath(import.meta.url)), "..", "skills");
const flat = (rel) => readFileSync(join(SKILLS, rel), "utf8").replace(/\s+/g, " ");

test("the digest accounts a material market by the answer that reached it, and only one no question reached is unsearched", () => {
  const digest = flat("clearance-register/digest.md");
  assert.ok(digest.includes("every material jurisdiction must be accounted for. One covered by a complete worldwide or regional answer, or by a "
    + "narrowed list that was read, is accounted for by that answer. One the identical mark's narrowing left inside a crowd, because the one "
    + "market list did not name it, stays in that crowd's count on the crowd's own row. Only a material jurisdiction no question reached at all "
    + "is an **unsearched dangerous slice**: write it `deferred` if it could not reach its data, else `coverage-limited`, with a reason that "
    + "NAMES the slice"));
  for (const gone of ["A material jurisdiction whose exact-in-class-live slice was", "(the funnel never reached it)"])
    assert.ok(!digest.includes(gone), `the digest still says "${gone}"`);
});

test("the write-up's coverage judgment no longer counts a material market's band as a slice of its own", () => {
  const job = { marks: [{ name: "ORBANTIQ", classes: [9] }], markName: "ORBANTIQ", name: "ORBANTIQ", classes: [9], ref: "TMP8190",
    customer: "QUILLAMOR", goods: "software", forwarder: "requester", msgId: "<m>" };
  const message = STAGES.synthesis.message({ paths: paths("/RUN"), job, axes: REGISTER_AXES, registerOnly: false, agent: "mailagent",
    run: { slug: "s", codename: "c" } });
  const block = message.match(/COVERAGE JUDGMENT \(MANDATORY[\s\S]*?Be specific — name the slice/)?.[0] ?? "";
  assert.ok(block, "guard: the coverage-judgment dictation is in the message");
  assert.ok(block.includes("(exact/near-identical named variant × in-scope class) drives sufficient:false"));
  assert.ok(block.includes("in an in-scope class was NOT enumerated to has_more:false) → sufficient:false"));
  for (const gone of ["× in-scope class × material jurisdiction", "or a material jurisdiction's named band is unfinished"])
    assert.ok(!block.includes(gone), `the coverage judgment still says "${gone}"`);
});

test("the frame's manual names the markets that matter, and does not send a crowd to each of them", () => {
  const frame = flat("matter-frame/SKILL.md");
  assert.ok(frame.includes("- On a worldwide order this set names the markets that matter for the matter's scripts and meanings, and frame-diff "
    + "checks citations against it; it is not a list of markets each crowd is asked in. A crowd's market step uses the one list the register "
    + "step's opening message names. On a named order this set is the order's own territories, and frame-diff checks it both ways (a citation "
    + "outside the scope set = over-reach; a market in the set left unsearched = under-coverage — disclosed + clamped, never a silent clean)."));
  assert.ok(!frame.includes("This set drives the per-jurisdiction sub-queries AND the major-jurisdiction floor"),
    "the frame's manual still sends a question to every market in the set");
});
