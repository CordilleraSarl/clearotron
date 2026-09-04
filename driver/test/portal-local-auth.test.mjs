// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// portal-local-auth.test.mjs —: the third identity source, tested where it is decidable.
//
// Everything in driver/portal-local-auth.mjs is a pure function over injected inputs, so all of it is
// reachable with no server, no clock and no environment. What is asserted here is the credential
// lifecycle, the session token, and the one property the design rests on:
//
//   A CONFIRMATION TOKEN AND A SESSION TOKEN SHARE A SECRET AND CANNOT BE SWAPPED.
//
// That is the whole justification for reusing PORTAL_SECRET instead of adding a second required value,
// and it is proved below by signing the SAME body both ways and showing that only the prefixed
// signature verifies. A test that merely fed a whole confirmation token to verifySession would pass on
// the payload shape alone and would still pass if the domain separator were deleted.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, statSync, writeFileSync, readFileSync, chmodSync, mkdirSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";
import { createHmac } from "node:crypto";

import { readLocalCredential, establishCredential, checkPassphrase, mintSession, verifySession,
  makeAttemptLimiter, SESSION_DOMAIN, localCredentialHandoff, firstRunCredentialLines } from "../portal-local-auth.mjs";
import { makePrincipal } from "../portal-access.mjs";
import { mintConfirmation, verifyConfirmation, jobHashOf } from "../portal-service.mjs";

const SECRET = "a-portal-secret-shared-by-both-token-families";
const USER = "one@laptop.example";
const tmp = (name) => join(mkdtempSync(join(tmpdir(), "portal-localauth-")), name);

// ── the credential ─────────────────────────────────────────────────────────────────────────────────

test("#769 establish → check: the right passphrase is true, a wrong one is false, and the record round-trips", () => {
  const path = tmp("credential.json");
  const { passphrase, generated } = establishCredential({ path, email: USER });
  assert.equal(generated, true, "no passphrase supplied ⇒ one is generated");
  assert.ok(passphrase.length >= 20, `a generated passphrase must not be guessable; got ${passphrase.length} characters`);

  const rec = readLocalCredential(path);
  assert.equal(rec.email, USER);
  assert.ok(rec.createdAt, "the record says when it was minted");
  assert.ok(!JSON.stringify(rec).includes(passphrase), "THE PLAINTEXT MUST NOT BE IN THE RECORD");
  assert.ok(!readFileSync(path, "utf8").includes(passphrase), "…nor anywhere in the file");

  assert.equal(checkPassphrase(rec, passphrase), true);
  assert.equal(checkPassphrase(rec, `${passphrase}x`), false, "a suffix is not the passphrase");
  assert.equal(checkPassphrase(rec, passphrase.slice(0, -1)), false, "nor is a prefix");
  assert.equal(checkPassphrase(rec, ""), false);
  // A wrong-LENGTH input is the case timingSafeEqual throws on. The compare is over derived digests,
  // which are equal-length by construction, so none of these may raise.
  for (const wrong of [null, undefined, 42, {}, [], "x", "x".repeat(10000)])
    assert.doesNotThrow(() => assert.equal(checkPassphrase(rec, wrong), false), `checkPassphrase(${typeof wrong}) must answer false, never throw`);
  assert.equal(checkPassphrase(null, passphrase), false, "no record is not a match");
});

test("#769 a supplied passphrase is honoured and reported as NOT generated", () => {
  const path = tmp("credential.json");
  const r = establishCredential({ path, email: USER, passphrase: "correct horse battery staple" });
  assert.equal(r.generated, false);
  assert.equal(r.passphrase, "correct horse battery staple");
  assert.equal(checkPassphrase(readLocalCredential(path), "correct horse battery staple"), true);
});

test("#769 the credential file is written 0600, and its directory 0700", () => {
  // A credential a second account on the box can read is not a credential. The mode is asserted rather
  // than assumed because `mode:` on writeFileSync is masked by the process umask and applies only on
  // create — which is why establishCredential also chmods, and why this checks the result.
  const dir = join(mkdtempSync(join(tmpdir(), "portal-localauth-")), "nested", "state");
  const path = join(dir, "credential.json");
  establishCredential({ path, email: USER });
  assert.equal(statSync(path).mode & 0o777, 0o600, "the credential must be readable by its owner only");
  assert.equal(statSync(dir).mode & 0o777, 0o700, "…and so must the directory it was created in");
});

test("#769 establishing over an existing credential is REFUSED, not silently overwritten", () => {
  // Overwriting would mint a passphrase over one somebody has already written down and print the new
  // one as though it were the first. `flag: "wx"` makes the refusal atomic — a check-then-write would
  // still lose the race with a second process starting at the same moment.
  const path = tmp("credential.json");
  const first = establishCredential({ path, email: USER });
  assert.throws(() => establishCredential({ path, email: USER }), /EEXIST/);
  assert.equal(checkPassphrase(readLocalCredential(path), first.passphrase), true, "the original still works");
});

test("#769 establishCredential refuses an identity that is not an address", () => {
  for (const bad of [null, "", "   ", "nobody"])
    assert.throws(() => establishCredential({ path: tmp("c.json"), email: bad }), /email address is required/);
});

// ── absence versus corruption ──────────────────────────────────────────────────────────────────────

test("#769 readLocalCredential: MISSING is null, BROKEN throws — an absence is a finding, a corrupt file is not an absence", () => {
  // The whole reason this distinction is load-bearing: the bootstrap answers null by MINTING A NEW
  // PASSPHRASE. A corrupt file read as null would replace a working credential with one nobody holds,
  // print it to a terminal nobody is watching, and lock the owner out with no error anywhere.
  assert.equal(readLocalCredential(tmp("never-written.json")), null, "no file ⇒ no user configured");

  const good = tmp("ok.json");
  establishCredential({ path: good, email: USER });
  const rec = readLocalCredential(good);

  const broken = {
    "not JSON at all": "}{ this was edited by hand",
    "JSON but not an object": "[1,2,3]",
    "an object with no fields": "{}",
    "missing the hash": JSON.stringify({ ...rec, hash: undefined }),
    "missing the salt": JSON.stringify({ ...rec, salt: undefined }),
    "an empty hash": JSON.stringify({ ...rec, hash: "" }),
    "parameters this build cannot derive": JSON.stringify({ ...rec, algo: "scrypt$N=1048576,r=8,p=1,keylen=64" }),
  };
  for (const [why, text] of Object.entries(broken)) {
    const p = tmp("broken.json");
    writeFileSync(p, text);
    assert.throws(() => readLocalCredential(p), (e) => e instanceof Error && /credential/.test(e.message),
      `${why} must THROW — reading it as null would mint a new passphrase over it`);
  }
});

// DECLARED SKIP, replacing an early `return` under root: the return reported `ok` for a test that had
// asserted nothing, and in the output that is indistinguishable from the wall having been proved. Root
// reads straight through mode 000, so there is no denial to observe — which is a fact about the reader,
// not about the credential, and the run should say so by name rather than by a silent pass.
test("#769 readLocalCredential: a file that exists and cannot be read throws rather than reading as absent",
  { skip: process.getuid?.() === 0 && "root reads through mode 000 — no denial to observe" }, () => {
  // Distinct from a malformed file: same wrong answer (a new passphrase minted over a working one), a
  // different cause.
  const path = tmp("unreadable.json");
  establishCredential({ path, email: USER });
  chmodSync(path, 0o000);
  try {
    assert.throws(() => readLocalCredential(path), /could not be read/);
  } finally { chmodSync(path, 0o600); }
});

test("#769 a hand-created directory is left at the mode its owner chose", () => {
  // establishCredential tightens only what it created. Re-permissioning a directory the operator
  // already had would be a side effect nobody asked for, and the file's own 0600 is the wall that
  // matters.
  const dir = mkdtempSync(join(tmpdir(), "portal-localauth-"));
  mkdirSync(join(dir, "mine"), { mode: 0o755 });
  chmodSync(join(dir, "mine"), 0o755);
  establishCredential({ path: join(dir, "mine", "credential.json"), email: USER });
  assert.equal(statSync(join(dir, "mine")).mode & 0o777, 0o755, "an existing directory is not re-permissioned");
  assert.equal(statSync(join(dir, "mine", "credential.json")).mode & 0o777, 0o600, "the file still is");
});

// ── the session token ──────────────────────────────────────────────────────────────────────────────

test("#769 mint → verify returns the email; a tampered body, a tampered signature and a wrong secret all fail", () => {
  const token = mintSession({ email: USER, secret: SECRET });
  assert.deepEqual(verifySession({ token, secret: SECRET }), { email: USER });

  const [tag, body, sig] = token.split(".");
  assert.equal(tag, "ps1", "the family is named in the token, not inferred from its shape");

  // A body swapped for another identity, re-encoded but NOT re-signed — the forgery this exists to stop.
  const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body, "base64url").toString("utf8")), sub: "someone@else.example" })).toString("base64url");
  assert.equal(verifySession({ token: `ps1.${forged}.${sig}`, secret: SECRET }), null, "a rewritten identity must not verify");

  assert.equal(verifySession({ token: `ps1.${body}.${sig.slice(0, -1)}x`, secret: SECRET }), null, "a tampered signature fails");
  assert.equal(verifySession({ token, secret: `${SECRET}-different` }), null, "another instance's secret does not open this session");
  assert.equal(verifySession({ token, secret: "" }), null, "no secret verifies nothing");

  for (const bad of [null, undefined, 42, "", "garbage", "ps1", "ps1.body", "ps1..sig", "v1.body.sig",
    `ps2.${body}.${sig}`, `${body}.${sig}`, `ps1.!!!notbase64!!!.${sig}`,
    `ps1.${Buffer.from("[1,2,3]").toString("base64url")}.${sig}`])
    assert.equal(verifySession({ token: bad, secret: SECRET }), null, `${String(bad)} must not verify`);
});

test("#769 an expired session is refused, and the boundary is exact", () => {
  const now = 1_800_000_000_000;                 // a fixed clock — a test that drifts with the date is not a test
  const token = mintSession({ email: USER, secret: SECRET, ttlSec: 3600, now });
  assert.deepEqual(verifySession({ token, secret: SECRET, now }), { email: USER });
  assert.deepEqual(verifySession({ token, secret: SECRET, now: now + 3599_000 }), { email: USER }, "still valid a second before");
  assert.equal(verifySession({ token, secret: SECRET, now: now + 3600_000 }), null, "expiry is not inclusive");
  assert.equal(verifySession({ token, secret: SECRET, now: now + 86_400_000 }), null, "and a day later, certainly not");
  // The default is a working day, so nobody is signed out mid-task and nobody is signed in for a month.
  const dflt = mintSession({ email: USER, secret: SECRET, now });
  assert.deepEqual(verifySession({ token: dflt, secret: SECRET, now: now + 11 * 3600_000 }), { email: USER });
  assert.equal(verifySession({ token: dflt, secret: SECRET, now: now + 13 * 3600_000 }), null);
});

test("#769 mintSession refuses to mint without a secret or without an identity", () => {
  assert.throws(() => mintSession({ email: USER, secret: "" }), /signing secret is required/);
  assert.throws(() => mintSession({ email: "", secret: SECRET }), /must name the identity/);
});

test("#769 the identity is normalised on the way in, so the session and the roster agree on one spelling", () => {
  const token = mintSession({ email: "  One@Laptop.Example  ", secret: SECRET });
  assert.deepEqual(verifySession({ token, secret: SECRET }), { email: USER },
    "makePrincipal lowercases; a session that carried the typed case would compare unequal to the configured user");
});

// ── THE DOMAIN SEPARATOR ───────────────────────────────────────────────────────────────────────────

test("#769 ONE SECRET, TWO FAMILIES: a confirmation signature cannot open a session, and only the prefix separates them", () => {
  // Isolate the variable. The SAME body is signed both ways with the SAME secret; the only difference
  // is the literal `portal-session.v1|` prefix. If the separator were removed from mintSession/
  // verifySession, the first assertion below would flip and this test would fail — which is the
  // property, rather than a restatement of it.
  const body = mintSession({ email: USER, secret: SECRET }).split(".")[1];
  const confirmationStyle = createHmac("sha256", SECRET).update(body).digest("base64url");
  const sessionStyle = createHmac("sha256", SECRET).update(SESSION_DOMAIN + body).digest("base64url");
  assert.notEqual(confirmationStyle, sessionStyle, "the two families sign different messages over the same key");

  assert.equal(verifySession({ token: `ps1.${body}.${confirmationStyle}`, secret: SECRET }), null,
    "a signature minted the CONFIRMATION way must not verify as a session — this is the domain separator doing its job");
  assert.deepEqual(verifySession({ token: `ps1.${body}.${sessionStyle}`, secret: SECRET }), { email: USER },
    "…and the same body with the prefixed signature does verify, so nothing else is doing the work");
});

test("#769 a real confirmation token cannot be replayed as a session, and a real session cannot be replayed as a confirmation", () => {
  // The whole-token direction, against the LIVE mint/verify pair on both sides.
  const account = "aurora";
  const jobHash = jobHashOf({ markName: "vantor", classes: [9], goods: "software" });
  const conf = mintConfirmation({ secret: SECRET, account, email: USER, jobHash });
  const [cBody, cSig] = conf.split(".");

  assert.equal(verifySession({ token: conf, secret: SECRET }), null, "a confirmation token is not a session");
  assert.equal(verifySession({ token: `ps1.${cBody}.${cSig}`, secret: SECRET }), null,
    "…nor is one dressed up in the session's own three-part shape");

  const [, sBody, sSig] = mintSession({ email: USER, secret: SECRET }).split(".");
  // verifyConfirmation returns null for OK and a sentence for every refusal.
  assert.equal(typeof verifyConfirmation({ secret: SECRET, token: `${sBody}.${sSig}`, account, email: USER, jobHash }), "string",
    "a session token is not a confirmation — it must be refused, not accepted as a licence to spend");
  // The control: the real confirmation token still verifies, so the refusals above are about the token
  // family and not about a secret or a jobHash that never matched anything.
  assert.equal(verifyConfirmation({ secret: SECRET, token: conf, account, email: USER, jobHash }), null);
});

// ── the identity handed on ─────────────────────────────────────────────────────────────────────────

test("#769 a local sign-in reaches makePrincipal with the SAME { email } shape the CF path produces", () => {
  // The claim this file makes about itself: it produces an identity, not an authorization. The address
  // out of verifySession goes into makePrincipal untouched and is judged by the roster exactly as a
  // Cloudflare-verified address is — staff by domain, client by grant, and a stranger gets nothing.
  const grants = { tenants: { celta: { accounts: ["aurora"], users: { [USER]: ["aurora"] } } } };
  const staffDomains = ["example-firm.com"];

  const client = verifySession({ token: mintSession({ email: USER, secret: SECRET }), secret: SECRET });
  assert.deepEqual(Object.keys(client), ["email"], "an identity is an email and nothing else — no role, no accounts, no claims");
  assert.deepEqual(makePrincipal({ email: client.email, grants, staffDomains }),
    { role: "client", email: USER, accounts: ["aurora"] });

  const staff = verifySession({ token: mintSession({ email: "lawyer@example-firm.com", secret: SECRET }), secret: SECRET });
  assert.deepEqual(makePrincipal({ email: staff.email, grants, staffDomains }),
    { role: "staff", email: "lawyer@example-firm.com", accounts: "*" });

  // SIGNING IN IS NOT BEING ENROLLED. A perfectly valid session for an address the roster does not know
  // gets no principal, which is a 403 at the door — the same answer the edge path gives.
  const stranger = verifySession({ token: mintSession({ email: "who@nowhere.example", secret: SECRET }), secret: SECRET });
  assert.equal(makePrincipal({ email: stranger.email, grants, staffDomains }), null);
});

// ── the attempt limiter ────────────────────────────────────────────────────────────────────────────

test("#769 login attempts are counted in a fixed window, and the window reopens", () => {
  const now = 1_800_000_000_000;
  const lim = makeAttemptLimiter({ max: 3, windowMs: 60_000 });
  for (let i = 0; i < 3; i++) assert.equal(lim.take("127.0.0.1", now + i), true, `attempt ${i + 1} is allowed`);
  assert.equal(lim.take("127.0.0.1", now + 10), false, "the fourth inside the window is refused");
  assert.equal(lim.take("127.0.0.1", now + 59_999), false, "…and still is at the last millisecond of it");
  assert.equal(lim.take("127.0.0.1", now + 60_000), true, "the window reopens rather than locking the machine out for good");
  // Separate peers are counted separately. On a loopback install there is only ever one key, which is
  // why the limiter's own comment says the window is effectively global there.
  assert.equal(lim.take("10.0.0.9", now + 60_000), true);
});

// ── the default location ───────────────────────────────────────────────────────────────────────────

test("#769 the credential default is under the operator's home, never in the repo and never in the pool", () => {
  // Asserted on the resolver's own source rather than by booting: this is a one-line decision that
  // would be invisible in any behavioural test, and getting it wrong writes a credential into a git
  // checkout or into the client-matter archive.
  //
  // MOVED THE LINE, NOT THE PROPERTY. The default used to be computed inline in
  // portal-service.mjs; `clearotron passphrase --reset` has to resolve the SAME file, and a path
  // computed twice is a path that can disagree once — so it became `credentialPathFor()` here. This
  // arm follows it. Every assertion below is unchanged: what it guards is where the default lands,
  // and that is still one line in one file.
  const src = readFileSync(new URL("../portal-local-auth.mjs", import.meta.url), "utf8");
  const line = src.split("\n").find((l) => l.includes("PORTAL_LOCAL_CREDENTIAL"));
  assert.ok(line, "PORTAL_LOCAL_CREDENTIAL is not read anywhere — the credential path has stopped being configurable");
  assert.match(line, /homedir\(\)/, "the default must derive from homedir(), never a literal /home/<user>");
  assert.ok(!/HERE|poolRoot|CLEAROTRON_REPORTS_DIR/.test(line),
    "the default must not land in the checkout or in the pool — one is a diff, the other is client matter");
  assert.ok(homedir(), "…and homedir() answers on this box, so the default is reachable");
});

// ── — the passphrase reaches a person, never a journal ────────────────────
//
// The handoff was correct for the case it was written for and wrong in every other: under systemd
// stderr is the journal, under CI a build log kept indefinitely, under a harness a captured string an
// assertion embeds. That last one HAPPENED — a live generated passphrase reached a runner's output
// through a failing assertion. It was ephemeral; on CI it would have been durable and world-readable.

test("1960 on a terminal the passphrase is handed over, once", () => {
  const h = localCredentialHandoff({ isTTY: true, resetCommand: "clearotron passphrase --reset" });
  assert.equal(h.printPassphrase, true);
  assert.equal(h.mint, true);
  assert.equal(h.refusal, null);
  const lines = firstRunCredentialLines({
    handoff: h, credentialPath: "/tmp/c.json", email: "a@b.com", passphrase: "S3CRET-VALUE",
    resetCommand: "clearotron passphrase --reset",
  });
  assert.ok(lines.join("\n").includes("S3CRET-VALUE"),
    "the terminal branch is the ONE place this is printed — if it stops printing, an operator has an "
    + "install they cannot sign into, which is the failure the whole handoff exists to prevent");
});

test("1960 off a terminal the secret is absent from the output EVEN WHEN IT IS PASSED IN", () => {
  // ✕ THE PLANT THAT MATTERS. Asserting "we took the else branch" proves the branch, not the absence.
  // The secret is handed to the composer here deliberately — a caller that wires it through the wrong
  // branch is the realistic mistake, and it would leak without ever changing which branch ran.
  const h = localCredentialHandoff({ isTTY: false, resetCommand: "clearotron passphrase --reset" });
  assert.equal(h.printPassphrase, false);
  assert.equal(h.mint, true, "a credential IS still created — the operator is told, and the reset works off it");

  const out = firstRunCredentialLines({
    handoff: h, credentialPath: "/tmp/c.json", email: "a@b.com", passphrase: "S3CRET-VALUE",
    resetCommand: "clearotron passphrase --reset",
  }).join("\n");

  assert.ok(!out.includes("S3CRET-VALUE"),
    `the passphrase reached a non-terminal stderr, which is durable:\n${out}`);
  assert.ok(out.includes("/tmp/c.json"), "the file must be named — it is what the operator acts on");
  assert.ok(out.includes("clearotron passphrase --reset"),
    "a non-terminal boot that does not name the recovery route leaves an install nobody can sign into");
});

test("1960 with no recovery route to name it REFUSES, and mints nothing", () => {
  // Minting first and discovering afterwards that nobody can be handed it is the silent invention:
  // the digest is on disk, the plaintext is gone, and no sentence says why sign-in fails.
  const h = localCredentialHandoff({ isTTY: false, resetCommand: "" });
  assert.equal(h.mint, false, "nothing may be created on a path that cannot deliver it");
  assert.equal(h.printPassphrase, false);
  assert.match(h.refusal, /not a terminal/);
  // Unreachable from today's service, which composes its command from a literal — stated in the source
  // and again here so a reader does not mistake it for a live protection.
  assert.equal(localCredentialHandoff({ isTTY: false, resetCommand: "  " }).mint, false,
    "whitespace is not a command");
});
