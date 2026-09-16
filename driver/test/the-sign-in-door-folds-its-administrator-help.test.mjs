// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// The sign-in door leads with what the person at it needs, and keeps the administrator's lines in a fold.
//
// A person arriving at the local sign-in page needs the passphrase field, the button, and one fact: this
// install signs in one person. The reset command and the way to add people are an administrator's
// business. They stay on the page word for word — someone locked out has to be able to find them — but
// in a closed "Administrator help" fold under that one bold line. Driven from `loginPage` itself, because
// what matters is the order and the nesting of the HTML a browser receives.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { loginPage, LOGIN_IN_FRONT_DOC } from "../portal-service.mjs";
import { SOURCE_REPO } from "../../shared/product-identity.mjs";

const REPO = fileURLToPath(new URL("../..", import.meta.url));
const page = loginPage({ email: "dana@northwind.example" });
const body = page.slice(page.indexOf("<body>"));
const fold = /<details class="fold">([\s\S]*?)<\/details>/.exec(body);
const flat = (s) => s.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();

test("the card keeps its heading, identity line, field and button, then one bold line", () => {
  assert.match(body, /<h1>Sign in<\/h1>/);
  assert.match(body, /<p>Clearotron portal, as <span class="who">dana@northwind\.example<\/span>\.<\/p>/);
  assert.match(body, /<label for="passphrase">Passphrase<\/label>/);
  assert.match(body, /<button type="submit">Sign in<\/button>/);
  const lead = body.indexOf('<p class="lead"><b>This Clearotron signs in one person: you.</b></p>');
  assert.ok(lead > body.indexOf("</form>"), "the one-person line is not the line under the button");
});

test("the administrator's two lines sit in a fold that renders closed, behind a quiet link", () => {
  assert.ok(fold, "there is no Administrator help fold");
  assert.doesNotMatch(body, /<details class="fold" open/, "the fold renders open");
  assert.ok(body.indexOf('<details class="fold">') > body.indexOf('<p class="lead">'), "the fold is not under the one-person line");
  assert.equal(flat(/<summary>([\s\S]*?)<\/summary>/.exec(fold[1])?.[1] ?? ""), "Administrator help");
  const inside = flat(fold[1]);
  assert.match(inside, /Lost the passphrase\? Run clearotron passphrase --reset on the machine running this portal\. It mints a new one and prints it once\./);
  assert.match(inside, /To add people, put it behind a login system such as your company single sign-on\. How to set that up/);
  // Nothing of it is left outside the fold, where it would lead again.
  const outside = flat(body.replace(fold[0], ""));
  assert.doesNotMatch(outside, /Lost the passphrase|To add people/, "an administrator's line is still outside the fold");
});

test("the reset line still shows this install's own command, bare in its code element", () => {
  const line = "npx clearotron@0.3.0-beta.5 passphrase --reset --base $HOME/trademark-demo";
  const long = loginPage({ email: "dana@northwind.example", resetCommand: line });
  const longFold = /<details class="fold">([\s\S]*?)<\/details>/.exec(long)?.[1] ?? "";
  assert.ok(longFold.includes(`<code>${line}</code>`), "the fold does not carry the reset line the portal was given");
  // A long command wraps inside the card rather than running past its edge.
  assert.match(long, /code \{[^}]*overflow-wrap:anywhere/, "a long reset command can push past the card");
});

test("How to set that up opens the document People links to, in the repository the server names", () => {
  assert.equal(LOGIN_IN_FRONT_DOC, `${SOURCE_REPO}/blob/main/docs/PORTAL.md#putting-your-own-login-provider-in-front`);
  assert.ok(fold[1].includes(`<a href="${LOGIN_IN_FRONT_DOC}" target="_blank" rel="noreferrer">How to set that up</a>`));
  const doc = readFileSync(join(REPO, "docs/PORTAL.md"), "utf8");
  const anchors = [...doc.matchAll(/^#{1,6}\s+(.+)$/gm)].map((m) => m[1].toLowerCase().replace(/[^a-z0-9 -]/g, "").trim().replace(/\s+/g, "-"));
  assert.ok(anchors.includes(LOGIN_IN_FRONT_DOC.split("#")[1]), "the anchor is not a heading in docs/PORTAL.md");
  // ONE DOCUMENT FOR ONE QUESTION. The portal's People screens link the same section; if either moves,
  // both have to, or a person is sent two places for the same answer.
  const walk = (dir) => readdirSync(dir).flatMap((e) => statSync(join(dir, e)).isDirectory() ? walk(join(dir, e)) : [join(dir, e)]);
  const portal = walk(join(REPO, "portal-ui/src")).filter((f) => /\.tsx?$/.test(f))
    .flatMap((f) => [...readFileSync(f, "utf8").matchAll(/docs\/PORTAL\.md#[a-z0-9-]+/g)].map((m) => m[0]));
  assert.ok(portal.length > 0, "the portal no longer links this document at all — this arm is comparing against nothing");
  for (const link of portal) assert.equal(link, "docs/PORTAL.md#putting-your-own-login-provider-in-front", `the portal links ${link}`);
});

test("the signed-in page is unchanged: no fold, no one-person line", () => {
  const signedIn = loginPage({ email: "dana@northwind.example", signedIn: true });
  assert.doesNotMatch(signedIn, /<details|signs in one person/);
  assert.match(signedIn, /You are signed in as/);
});
