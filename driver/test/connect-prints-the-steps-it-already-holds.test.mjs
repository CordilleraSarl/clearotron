// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// — F35. `connect` printed the address and the key and withheld the steps it
// already held. The owner was left with two strings and no destination: *"I don't know how to connect
// it in Claude Cowork with those details."*
//
// The steps were DEFINED IN THE PRODUCT the whole time. `withSteps` computes them for every offer,
// interpolating this install's own address and operator, and the portal's page renders them for the
// stdio clients. The verb simply never printed its own.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { whatItNeeds, clientById, CONNECT_CLIENTS } from "../../shared/connect-clients.mjs";
import { nonEmpty } from "../../shared/vacuous-pass.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const CONNECT_SRC = readFileSync(join(HERE, "..", "..", "bin", "connect.mjs"), "utf8");

const PUBLISHED = { stdioRoutes: {}, publicAddress: "https://x.example/mcp", operator: "op@localhost" };

test("2176-F35 the offer a served client gets actually carries steps to print", () => {
  // If this is ever empty the fix below prints nothing and passes in silence, so the data comes first.
  const offer = whatItNeeds(clientById("cowork"), PUBLISHED);
  assert.equal(offer.served, true, "expected a served offer on a published install");
  const steps = nonEmpty(offer.steps, "the served offer's steps");
  assert.ok(steps.length >= 2, `a destination needs more than one step, got ${JSON.stringify(steps)}`);
  // They are THIS install's, not a template: the address the reader was just handed appears in them.
  assert.ok(steps.some((s) => s.includes("https://x.example/mcp")),
    `the steps must name the address this install serves, got ${JSON.stringify(steps)}`);
});

test("2176-F35 connect prints them, and does not author a second set", () => {
  assert.match(CONNECT_SRC, /offer\.steps\?\.length/,
    "the verb must print the steps the offer carries");
  assert.match(CONNECT_SRC, /offer\.steps\.forEach/, "and print them in order, numbered");
  // A second set written at the CLI would drift from the page's. The whole file is data-not-branches and
  // this is the seam where a well-meaning author would break it.
  assert.doesNotMatch(CONNECT_SRC, /Settings → Connectors/,
    "the CLI must not restate a client's instructions — that is what connect-clients-are-data forbids");
});

test("2176-F35 every client that is served can be told where to put what it was given", () => {
  // The class. Printing steps for Cowork and nothing for the next client is the shape this finding
  // already had once — a fact the product held and one surface did not use.
  const missing = [];
  for (const c of nonEmpty(CONNECT_CLIENTS, "the client table")) {
    const offer = whatItNeeds(c, PUBLISHED);
    if (!offer?.served) continue;                       // a refusal has its own sentence, tested elsewhere
    if (!offer.steps?.length) missing.push(c.id);
  }
  assert.deepEqual(missing, [],
    `these clients are served an address and a key with nowhere to put them: ${missing.join(", ")}`);
});
