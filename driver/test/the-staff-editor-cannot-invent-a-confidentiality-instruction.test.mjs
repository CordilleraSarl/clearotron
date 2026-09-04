// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// the-staff-editor-cannot-invent-a-confidentiality-instruction.test.mjs —.
//
// `delivery.privileged` is THREE-state and every state is load-bearing: `false` is a customer
// instructing us to strip the confidentiality marking, absent is no instruction at all — and absent gets
// the marking, because that is what any legal deliverable carries. The staff editor rendered the field as
// a CHECKBOX, which has two states: it drew absent and `false` identically and wrote a boolean on every
// save. So a customer who had never given an instruction was recorded as "strip the line" the first time
// anybody pressed Save on an unrelated field, and their next report shipped unmarked.
//
// WHY THIS DRIVES THE SHIPPED TEMPLATE RATHER THAN A COPY OF ITS RULE: the defect lived in the page's own
// composition line, so an arm that restates that line in JavaScript would have passed against the broken
// page. Both halves below are EXTRACTED FROM driver/profile-page.html AND EXECUTED — the render fragment
// as the template literal it is, the collector as the statements they are. A shape that no longer matches
// is a could-not-look and fails by name; it is never a silent pass.
//
// SIBLING, the same rule from the other side: a-partial-payload-cannot-delete-what-it-omits.test.mjs
// pins the TRANSPORT seam — a payload that omits a key must not have the omission read as an
// instruction. This file pins the FORM seam — a control that cannot express "no instruction" must not
// invent one. Disjoint subsystems, one rule; a reader who finds either should know the other exists.
//
// The chain each arm walks is the one a customer's marking actually travels: what the page composes → what
// the service writes → what shared/brand.mjs confPosture() renders. confPosture is the single funnel both
// report renderers read (shared/brand.mjs:131), so asserting there asserts the client's page.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { makeProfileService } from "../profile-service.mjs";
import { confPosture, CONF_DEFAULT } from "../../shared/brand.mjs";

const TEMPLATE = fileURLToPath(new URL("../profile-page.html", import.meta.url));
const src = readFileSync(TEMPLATE, "utf8");
const STAFF = { email: "staff@example-firm.com" };

/** Render one `<select>` from the shipped template, as the page would, for a stored `delivery`. */
function renderControl(id, delivery) {
  const m = src.match(new RegExp(`<select id="${id}">[\\s\\S]*?</select>`));
  assert.ok(m, `could not find the ${id} control in the shipped template — the arm cannot look`);
  assert.equal(m[0].includes("`"), false, `${id}'s markup grew a backtick; this evaluator cannot host it`);
  return new Function("d", "return `" + m[0] + "`;")(delivery);
}

/** The option a staff member is looking at, for a stored `delivery`. */
function selectedOption(id, delivery) {
  const html = renderControl(id, delivery);
  const m = html.match(/<option value="([^"]*)" selected>([^<]*)<\/option>/);
  assert.ok(m, `${id} rendered no selected option for ${JSON.stringify(delivery)}`);
  return { value: m[1], label: m[2] };
}

/** Run collect()'s OWN delivery composition, from the shipped template. */
function composeDelivery(loaded, privChoice, email = "summary") {
  // Matches the composition WHATEVER its branches do, so a plant that keeps the shape and flips the
  // meaning (`else delivery.privileged = false`) is still extracted, executed and caught.
  const m = src.match(/ {2}const delivery = \{ \.\.\.\(\(current\.profile[\s\S]*?\n {2}if \(\$\("f_priv"\)\.value === "no"\)[^\n]*\n/);
  assert.ok(m, "could not find collect()'s delivery composition in the shipped template — the arm cannot look");
  const $ = (id) => ({ f_email: { value: email }, f_priv: { value: privChoice } })[id];
  return new Function("$", "current", `${m[0]}\nreturn delivery;`)($, { profile: { delivery: loaded } });
}

/** Run collectProject()'s OWN delivery composition, from the shipped template. */
function composeProjectDelivery(privChoice, email) {
  const m = src.match(/ {2}const email = \$\("p_email"\)\.value; if \(email\) \{[\s\S]*?\}\n/);
  assert.ok(m, "could not find collectProject()'s delivery composition in the shipped template — the arm cannot look");
  const $ = (id) => ({ p_email: { value: email }, p_priv: { value: privChoice } })[id];
  return new Function("$", "o", `${m[0]}\nreturn o;`)($, {}).delivery;
}

function svc(deliveryOnDisk) {
  const dir = mkdtempSync(join(tmpdir(), "priv-1991-"));
  writeFileSync(join(dir, "generic.json"), JSON.stringify({ name: "House default", platforms: ["amazon.com"] }));
  const onDisk = { name: "Acme", platforms: ["amazon.com"], ...(deliveryOnDisk ? { delivery: deliveryOnDisk } : {}) };
  writeFileSync(join(dir, "acme.json"), JSON.stringify(onDisk));
  mkdirSync(join(dir, "projects", "acme"), { recursive: true });
  let written = null, writtenOverlay = null;
  const service = makeProfileService({
    profileDir: dir,
    writeProfile: (a) => { written = a.profile; return { files: ["acme.json"] }; },
    writeProject: (a) => { writtenOverlay = a.overlay; return { files: ["projects/acme/p.json"] }; },
    gitCommit: () => "sha", audit: () => {},
  });
  return { service, onDisk, written: () => written, writtenOverlay: () => writtenOverlay };
}

/** A staff member edits ONLY the customer's name and presses Save. */
async function saveRenameOnly(service, loaded, privChoice) {
  const r = await service.route("POST", "/profiles/acme/save", STAFF, {
    profile: {
      name: "Acme Renamed", matchDomains: [], platforms: ["amazon.com"], marketplaceDensity: "sparse",
      defaultClasses: [], defaultJurisdictions: [], selfExclusionOwners: [],
      delivery: composeDelivery(loaded, privChoice),
    },
  });
  assert.equal(r.status, 200, `save failed: ${JSON.stringify(r.json)}`);
  return r;
}

test("1991: a customer who gave NO instruction keeps the marking when staff save an unrelated field", async () => {
  const loaded = { email: "summary" };                       // no `privileged` key — no instruction
  assert.equal(confPosture(loaded), CONF_DEFAULT, "precondition: this customer's report is marked");

  // What the staff member is looking at, having touched nothing.
  assert.equal(selectedOption("f_priv", loaded).value, "", "an absent instruction shows as the marked default");

  const { service, written } = svc(loaded);
  await saveRenameOnly(service, loaded, selectedOption("f_priv", loaded).value);

  assert.equal("privileged" in written().delivery, false,
    "no instruction was given, so none is stored — the checkbox used to write `false` here");
  assert.equal(confPosture(written().delivery), CONF_DEFAULT,
    "and the report the customer receives still carries its confidentiality marking");
  assert.equal(written().delivery.email, "summary", "the rest of delivery survives the save");
});

test("1991: the half that must NOT break — a customer who DID ask for no marking still gets none (#761)", async () => {
  const loaded = { email: "summary", privileged: false };    // a real instruction
  assert.equal(confPosture(loaded), "", "precondition: this customer asked for the line to be stripped");
  assert.equal(selectedOption("f_priv", loaded).value, "no", "and the page shows that instruction back");

  const { service, written } = svc(loaded);
  await saveRenameOnly(service, loaded, selectedOption("f_priv", loaded).value);

  assert.equal(written().delivery.privileged, false, "the instruction survives an unrelated edit");
  assert.equal(confPosture(written().delivery), "", "and the marking stays off");
});

test("1991: the instruction is UNDOABLE — picking the marked option clears a stored `false`", async () => {
  const loaded = { email: "summary", privileged: false };
  const { service, written } = svc(loaded);
  await saveRenameOnly(service, loaded, "");                 // staff pick "Privileged & Confidential"

  assert.equal("privileged" in written().delivery, false, "back to no instruction, not to a stored `true`");
  assert.equal(confPosture(written().delivery), CONF_DEFAULT, "and the report is marked again");
});

test("1991: the retired `true` reads as the marked default and never becomes `false`", async () => {
  // NOT HYPOTHETICAL: driver/profiles/aurora.json ships `"privileged": true`.
  const loaded = { email: "summary", privileged: true };
  assert.equal(confPosture(loaded), CONF_DEFAULT, "true and absent render identically (shared/brand.mjs)");
  assert.equal(selectedOption("f_priv", loaded).value, "", "so the page shows the marked default, not `No marking`");

  const { service, written } = svc(loaded);
  await saveRenameOnly(service, loaded, selectedOption("f_priv", loaded).value);

  assert.notEqual(written().delivery.privileged, false, "a retired value must never be read as an instruction to strip");
  assert.equal(confPosture(written().delivery), CONF_DEFAULT, "the customer's report stays marked");
});

test("1991: a project overlay does not invent the instruction either", async () => {
  assert.equal("privileged" in composeProjectDelivery("", "summary"), false,
    "an overlay that sets a format and gives no marking instruction stores none");
  assert.equal(confPosture(composeProjectDelivery("", "summary")), CONF_DEFAULT,
    "so a project inherits the marking rather than silently stripping it");
  assert.equal(composeProjectDelivery("no", "summary").privileged, false, "and `No marking` still reaches the overlay");
  assert.equal(composeProjectDelivery("", ""), undefined, "no format set ⇒ no delivery override at all");

  assert.equal(selectedOption("p_priv", { email: "summary" }).value, "", "an overlay with no instruction shows as marked");
  assert.equal(selectedOption("p_priv", { email: "summary", privileged: false }).value, "no", "and `false` shows back");
});

test("1991: neither marking control is a checkbox — the shape that cannot hold three states", () => {
  for (const id of ["f_priv", "p_priv"]) {
    assert.doesNotMatch(src, new RegExp(`<input type="checkbox" id="${id}"`),
      `${id} is a checkbox again: two states cannot express absent, \`false\` and the retired \`true\``);
    const labels = [...renderControl(id, {}).matchAll(/<option value="([^"]*)"[^>]*>([^<]*)<\/option>/g)];
    assert.deepEqual(labels.map((m) => m[1]), ["", "no"], `${id} offers exactly the two live states`);
    assert.deepEqual(labels.map((m) => m[2]), ["Privileged &amp; Confidential", "No marking"],
      `${id} carries the owner's ruled labels (tracker issue 1983)`);
  }
});
