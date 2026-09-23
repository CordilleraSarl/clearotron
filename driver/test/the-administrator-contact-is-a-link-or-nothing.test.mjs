// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// The administrator contact is a link a browser can follow, or it is nothing.
//
// Preferences tells a signed-in person to contact their Clearotron administrator to change their sign-in.
// An installation may name that contact; the words then link to it. The value is typed by an operator into
// an environment file and ends up in an `href`, so the one property worth holding is that only a mail
// address or a web address ever becomes one. A name, a telephone number or a `javascript:` address must
// read as unset: the words stay plain rather than opening something other than what they say.
//
// The module reads `process.env` at IMPORT time, so the environment half runs in a fresh process per case,
// the way the organisation-name arms beside this file do.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { administratorContact } from "../../shared/brand.mjs";

// A file URL, not a path: the program below imports it, and on Windows an absolute path is not an
// import specifier (its drive letter reads as a URL scheme).
const brandModule = new URL("../../shared/brand.mjs", import.meta.url).href;

/** Evaluate shared/brand.mjs in a fresh process under a given environment. */
function contactUnder(env) {
  const src =
    `import { ADMINISTRATOR_CONTACT } from ${JSON.stringify(brandModule)};` +
    `process.stdout.write(JSON.stringify({ contact: ADMINISTRATOR_CONTACT }));`;
  const out = execFileSync(process.execPath, ["--input-type=module", "-e", src], {
    env: { ...process.env, ...env },
    encoding: "utf8",
  });
  return JSON.parse(out).contact;
}

test("a mail address becomes a mailto link, whether or not the operator wrote the scheme", () => {
  assert.equal(administratorContact("it@northwind.example"), "mailto:it@northwind.example");
  assert.equal(administratorContact("mailto:it@northwind.example"), "mailto:it@northwind.example");
  assert.equal(administratorContact("  it+access@northwind.example \n"), "mailto:it+access@northwind.example",
    "surrounding whitespace from an env file is not part of the address");
});

test("a web address is kept as the link", () => {
  assert.equal(administratorContact("https://help.northwind.example/access"), "https://help.northwind.example/access");
  assert.equal(administratorContact("http://intranet.northwind.example/it"), "http://intranet.northwind.example/it");
});

test("anything that is neither is unset, so the words stay plain", () => {
  for (const raw of [undefined, null, "", "   ", "Dana in IT", "+41 22 555 01 01", "javascript:alert(1)",
    "JAVASCRIPT:alert(1)", "data:text/html,hi", "ftp://files.northwind.example/", "https://", "mailto:", "mailto:dana",
    "it@northwind", "//help.northwind.example/access", "help.northwind.example"]) {
    assert.equal(administratorContact(raw), null, `${JSON.stringify(raw)} became a link`);
  }
});

test("the installation setting is the variable read at start-up, and unset is the default", () => {
  assert.equal(contactUnder({ CLEAROTRON_ADMINISTRATOR_CONTACT: undefined }), null, "an installation that set nothing names a contact");
  assert.equal(contactUnder({ CLEAROTRON_ADMINISTRATOR_CONTACT: "it@northwind.example" }), "mailto:it@northwind.example");
  assert.equal(contactUnder({ CLEAROTRON_ADMINISTRATOR_CONTACT: "javascript:alert(1)" }), null);
});

test("the portal sends the contact on the same answer as the brand", () => {
  // Pinned at the source: the value differs only on an installation that set one, so a payload that
  // dropped it would keep every fixture-driven screen test green.
  const svc = readFileSync(fileURLToPath(new URL("../portal-service.mjs", import.meta.url)), "utf8");
  const me = svc.slice(svc.indexOf("brand: ORGANISATION_NAME"), svc.indexOf("brand: ORGANISATION_NAME") + 600);
  assert.ok(me.length > 0, "the /me payload moved — this arm is reading nothing");
  assert.match(me, /administratorContact: ADMINISTRATOR_CONTACT/, "the /me answer no longer carries the administrator contact");
});
