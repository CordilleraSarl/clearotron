// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// — F57. "doctor's connector check reports the challenge form, not just
// reachability — a 302 + Cloudflare-Access on an MCP route is a misconfiguration it can name."
//
// WHY REACHABILITY ALONE COULD NEVER CATCH IT. The probe calls anything under 500 an answer, on purpose:
// the door speaks MCP, not HTTP GET, so a 405 or a 400 IS a door answering and demanding 200 would red a
// correct deployment. A 302 is under 500. So the one shape that is reachable AND unusable passes the
// only question that was being asked, and every layer reports healthy while no assistant can connect.
//
// THE SERVERS HERE ARE REAL. The header is read off a live response through the same `fetch(..., {
// redirect: "manual" })` doctor uses, because the property under test is what a real answer produces —
// a fixture asserting a string comparison would pass over a probe that never captured the header.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { clientDoorReachability } from "../../shared/client-door.mjs";
import { triggerLaneVerdict } from "../../shared/trigger-lane.mjs";
import { challengeSchemes, challengeVerdict, blockedByAccessChallenge } from "../../shared/mcp-challenge.mjs";
import { trackedFiles, skipReason } from "../../shared/tracked-files.mjs";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const GUARD = "2180-F57 mcp challenge form";
const NO_CORPUS = skipReason(GUARD);

/** A door that answers exactly as named, probed the way `doctor` probes — header included. */
async function probeOf(status, headers) {
  const srv = createServer((req, res) => { res.writeHead(status, headers); res.end(); });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  const origin = `http://127.0.0.1:${srv.address().port}`;
  const url = `${origin}/mcp`;
  try {
    const res = await fetch(url, { method: "GET", signal: AbortSignal.timeout(2500), redirect: "manual" });
    // The probe construction from bin/onboard.mjs, both sites, verbatim in shape.
    return { origin, url, probe: { ok: res.status < 500, status: res.status, error: null,
      challenge: res.headers.get("www-authenticate") } };
  } finally { srv.close(); }
}

test("2180-F57 a real 302 + Cloudflare-Access is NAMED, not reported as an answering door", async () => {
  const { url, probe } = await probeOf(302, { location: "https://team.cloudflareaccess.com/",
    "www-authenticate": 'Cloudflare-Access realm="team"' });
  // First: the old question still says what it always said, so this arm is measuring the NEW one.
  assert.equal(probe.ok, true, "a 302 is reachable, which is why reachability alone could not catch this");

  const v = clientDoorReachability({ url, probe });
  assert.equal(v.state, "fail", `the blocked shape reported ${v.state}: ${v.message}`);
  assert.match(v.message, /NO ASSISTANT CAN CONNECT/, "it does not say what is actually broken");
  assert.match(v.message, /Cloudflare/, "it does not name where the fix is made");
  assert.match(v.message, /302/, "the status a reader would see is missing from the message");
});

test("2180-F57 the STAFF submit lane is the other MCP hostname and gets the same answer", async () => {
  // F57 names the client connector. Its own measurement covers BOTH hostnames, and two hand-rolled
  // rules for one question is how the second one stays green after the first is fixed.
  // PORTAL_MCP_URL is an ORIGIN — the portal's client appends /mcp itself, and the lane refuses a path
  // before it looks at anything else. Caught by that rule while writing this arm.
  const { origin, probe } = await probeOf(302, { location: "/x", "www-authenticate": "Cloudflare-Access" });
  const lane = triggerLaneVerdict({ url: origin, hasToken: true, verbs: ["start_run", "stop_run"], probe });
  assert.equal(lane.state, "fail", `the submit lane reported ${lane.state}: ${lane.message}`);
  assert.match(lane.message, /NO ASSISTANT CAN CONNECT/);
  // ONE SENTENCE, TWO SURFACES. If these diverge, a reader meets the same fault described two ways.
  const door = clientDoorReachability({ url: origin, probe });
  assert.equal(lane.message, door.message, "the two probes describe the same fault differently");
});

test("2180-F57 THE CONTROLS — a door that answers correctly is still green", async () => {
  // Without these the arm above passes on a check that reds everything, which is a worse defect than
  // the one it fixes: it would red every direct install on the documented path.
  const plain = await probeOf(401, {});                       // our own door sends no challenge at all
  assert.equal(clientDoorReachability(plain).state, "pass",
    "a direct client door, which emits no www-authenticate, was reported as broken");

  const oauth = await probeOf(401, { "www-authenticate": 'Bearer realm="OAuth"' });
  const v = clientDoorReachability(oauth);
  assert.equal(v.state, "pass", "the shape F57 measured as WORKING was reported as broken");
  assert.match(v.message, /Bearer challenge/, "the working form is not named as positive evidence");

  const speaking = await probeOf(405, {});                    // the door answering an HTTP GET it does not serve
  assert.equal(clientDoorReachability(speaking).state, "pass", "a 405 from a live MCP door is a door answering");
});

test("2180-F57 a realm that MENTIONS the scheme is not the scheme", async () => {
  // The header is structured: a scheme token, then parameters. Grepping the raw string finds the name
  // inside somebody's realm and reds a working door — the same error as matching prose about a defect
  // rather than the defect. This is the plant for that.
  const { url, probe } = await probeOf(401, { "www-authenticate": 'Bearer realm="Cloudflare-Access is down"' });
  assert.deepEqual(challengeSchemes(probe.challenge), ["bearer"], "a realm's contents were read as a scheme");
  assert.equal(clientDoorReachability({ url, probe }).state, "pass",
    "a Bearer door whose realm names Cloudflare-Access was refused");
});

test("2180-F57 a Cloudflare challenge WITHOUT a redirect is reported and not judged", async () => {
  // 302 + Cloudflare-Access is what was measured. A 401 carrying that scheme is a shape nobody has
  // driven, and a check that failed it would be claiming more than the finding established.
  const { url, probe } = await probeOf(401, { "www-authenticate": "Cloudflare-Access" });
  const v = clientDoorReachability({ url, probe });
  assert.equal(v.state, "pass", "an unmeasured shape was judged as broken");
  assert.match(v.message, /read this first/, "it passed silently, telling a stuck reader nothing");
});

test("2180-F57 a probe that never read the header does not claim the form was checked", () => {
  // THREE-VALUED. `headers.get` returns null for absent — a looked-and-none answer. A probe object
  // without the field at all never looked, and the two must not collapse: the second is the older shape
  // and any future caller that forgets the field.
  assert.equal(challengeVerdict({ status: 200 }).looked, false);
  assert.equal(challengeVerdict({ status: 200, challenge: null }).looked, true);
  const v = clientDoorReachability({ url: "https://mcp.example.com/mcp", probe: { ok: true, status: 200 } });
  assert.equal(v.state, "pass", "an older probe shape stopped working");
  assert.doesNotMatch(v.message, /Bearer|Cloudflare/,
    "it named a challenge form on a probe that never read one");
});

test("2180-F57 EVERY MCP-route probe captures the header — a third one cannot be born blind", (t) => {
  // The class, not the two instances. This defect existed twice for the same reason: each probe built
  // its own result object, and neither had a reason to think about a header. A third added tomorrow
  // would be blind in exactly the same way and every arm above would still pass.
  const files = trackedFiles(GUARD, { root: REPO, pathspec: ["*.mjs"] });
  if (!files) return t.skip(NO_CORPUS);
  const sources = files.filter((f) => !f.includes("/test/"));
  assert.ok(sources.length > 100, `expected the tracked source tree, found ${sources.length} file(s)`);
  const offenders = [];
  for (const f of sources) {
    const src = readFileSync(join(REPO, f), "utf8");
    for (const [i, line] of src.split("\n").entries()) {
      const t2 = line.trim();
      if (t2.startsWith("//") || t2.startsWith("*") || t2.startsWith("/*")) continue;
      // The DEFECT'S SHAPE: building a probe verdict out of a response's status.
      if (!/probe\s*=\s*\{\s*ok:\s*res\.status/.test(line)) continue;
      // Multi-line object: the field may be on the next line, so read the statement, not the line.
      const stmt = src.split("\n").slice(i, i + 4).join("\n");
      if (!/challenge:/.test(stmt)) offenders.push(`${f}:${i + 1}  ${t2.slice(0, 90)}`);
    }
  }
  assert.deepEqual(offenders, [],
    "these build a probe verdict from a status and never read the challenge form, so a Cloudflare-Access "
    + `redirect reads as an answering door:\n${offenders.join("\n")}`);
});

test("2180-F57 the document section the refusal sends a reader to still exists", () => {
  // A refusal that names a heading points at nothing the moment somebody retitles it, and the message
  // still reads perfectly. The failure is silent on both sides: the doc renames cleanly, the sentence
  // keeps its shape, and only the reader who followed it finds out.
  const msg = blockedByAccessChallenge("https://mcp.example.com/mcp", 302);
  const heading = msg.match(/under "([^"]+)"/)?.[1];
  assert.ok(heading, `the refusal stopped naming a section: ${msg}`);
  const install = readFileSync(join(REPO, "INSTALL.md"), "utf8");
  assert.ok(install.includes(heading),
    `the refusal sends a reader to "${heading}" in INSTALL.md, which no longer has a heading by that name`);
  // And the check it promises is there, not merely a heading with the right words over other content.
  const section = install.slice(install.indexOf(heading));
  assert.match(section.slice(0, 4000), /www-authenticate/,
    "the named section no longer carries the challenge-form check the refusal promises it does");
});
