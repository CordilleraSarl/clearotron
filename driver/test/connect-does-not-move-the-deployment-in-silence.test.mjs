// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// tracker issue 193 — `clearotron connect` repointed the whole install at whatever checkout it ran from.
//
// `CLEAROTRON_CHECKOUT_DIR` decides which tree every unit's ExecStart executes and which tree the
// deploy timer fast-forwards. `connect` wrote it from its own location, silently. Driven on testuser:
// the next deploy tick fast-forwarded a DETACHED worktree and failed with "You are not currently on a
// branch", and one unit was left executing the temporary worktree while three still ran the real
// checkout — because only the one connect restarted had restarted. Deleting that worktree would have
// left a door running fine and unable to ever start again.
//
// THE UNITS' ENV FILE CANNOT SEE THIS, which is the trap worth naming: it is the file connect is about
// to write, so after the write it agrees with the new value and the drift is invisible. The running
// processes are the only witnesses, and they are witnesses precisely because they have not restarted.
import test from "node:test";
import assert from "node:assert/strict";
import { checkoutMove, treeOfRunning, movePosture, describeMove, describeConflict,
  programsFromAnotherCheckout } from "../../shared/checkout-move.mjs";

const UNIT = "[Unit]\nDescription=x\n[Service]\nExecStart=/usr/bin/node ${CLEAROTRON_CHECKOUT_DIR}/mcp-server/http-server-client.mjs\n";
const REL = "mcp-server/http-server-client.mjs";
const cmd = (tree) => ["/usr/bin/node", `${tree}/${REL}`];

// ── is it a move at all ─────────────────────────────────────────────────────────────────────────────

test("193 writing a different tree is a MOVE, and both paths are named", () => {
  const m = checkoutMove("/home/testuser/clearotron", "/home/testuser/pr43");
  assert.equal(m.moving, true);
  const said = describeMove(m).join("\n");
  assert.match(said, /\/home\/testuser\/clearotron/, "the tree being left is not named");
  assert.match(said, /\/home\/testuser\/pr43/, "the tree being moved to is not named");
});

test("193 a FIRST write is not a move — an installer doing its job says so quietly", () => {
  // Collapsing these two would print a relocation warning on every fresh install, which teaches a
  // reader to skip the line on the one box where it means something.
  const m = checkoutMove("", "/opt/clearotron");
  assert.equal(m.moving, false);
  assert.equal(m.first, true);
  assert.doesNotMatch(describeMove(m).join("\n"), /MOVES THE WHOLE DEPLOYMENT/);
});

test("193 writing the SAME tree is not a move and says nothing at all", () => {
  const m = checkoutMove("/opt/clearotron", "/opt/clearotron");
  assert.equal(m.moving, false);
  assert.deepEqual(describeMove(m), [], "a no-op run printed a warning");
});

// ── which tree is a live process actually executing ─────────────────────────────────────────────────

test("193 the running tree comes off the process's own command line", () => {
  assert.equal(treeOfRunning(cmd("/home/testuser/pr43"), REL).tree, "/home/testuser/pr43");
  // The NUL-separated form, which is what /proc/<pid>/cmdline actually hands back.
  assert.equal(treeOfRunning(`/usr/bin/node\0/opt/clearotron/${REL}\0`, REL).tree, "/opt/clearotron");
});

test("193 a RELATIVE entrypoint yields no tree, because its base is the process's cwd", () => {
  // Resolving it against this command's cwd would produce a confident claim about the wrong tree, and
  // every sentence this module prints is a claim about which tree is live.
  const r = treeOfRunning(["/usr/bin/node", `./${REL}`], REL);
  assert.equal(r.tree, null);
  assert.match(r.why, /absolute/);
});

// ── the posture a move is judged against ────────────────────────────────────────────────────────────

test("193 a service running from another tree is a CONFLICT, named by unit and tree", () => {
  const move = checkoutMove("/home/testuser/clearotron", "/home/testuser/pr43");
  const p = movePosture({ move, running: [
    { unit: "clearotron-portal.service", cmdline: cmd("/home/testuser/clearotron"), unitText: UNIT, why: null },
  ] });
  assert.equal(p.state, "conflict");
  assert.deepEqual(p.conflicts, [{ unit: "clearotron-portal.service", tree: "/home/testuser/clearotron" }]);
  const said = describeConflict(p, move).join("\n");
  assert.match(said, /REFUSED/);
  assert.match(said, /clearotron-portal\.service/, "the reader is not told WHICH unit");
  assert.match(said, /--allow-checkout-move/, "and not told how to proceed anyway");
});

test("193 the mixed box from the finding: three units on the old tree, one already moved", () => {
  // Jaw's own table. The one unit `connect` restarted had followed the write; the other three had not,
  // and they are the ones that break. A posture that only looked at the door would have said "clear".
  const move = checkoutMove("/home/testuser/clearotron", "/home/testuser/pr43");
  const p = movePosture({ move, running: [
    { unit: "clearotron-mcp-face.service", cmdline: cmd("/home/testuser/clearotron"), unitText: UNIT, why: null },
    { unit: "clearotron-portal.service", cmdline: cmd("/home/testuser/clearotron"), unitText: UNIT, why: null },
    { unit: "clearotron-worker.service", cmdline: cmd("/home/testuser/clearotron"), unitText: UNIT, why: null },
    { unit: "clearotron-client-mcp.service", cmdline: cmd("/home/testuser/pr43"), unitText: UNIT, why: null },
  ] });
  assert.equal(p.state, "conflict");
  assert.deepEqual(p.conflicts.map((c) => c.unit).sort(),
    ["clearotron-mcp-face.service", "clearotron-portal.service", "clearotron-worker.service"],
    "the unit that had already restarted onto the new tree was reported as a conflict, or one that had not was missed");
});

test("193 every service already on the destination tree is CLEAR", () => {
  const move = checkoutMove("/old", "/new");
  const p = movePosture({ move, running: [{ unit: "u.service", cmdline: cmd("/new"), unitText: UNIT, why: null }] });
  assert.equal(p.state, "clear");
});

test("193 nothing readable is UNKNOWN, never a clear coast", () => {
  // An absence is a finding. A box where every unit was unreadable must not report the same thing as a
  // box that was genuinely all on one tree — the refusal below branches on exactly this.
  const move = checkoutMove("/old", "/new");
  const p = movePosture({ move, running: [
    { unit: "a.service", cmdline: null, unitText: UNIT, why: "it is not running" },
    { unit: "b.service", cmdline: null, unitText: UNIT, why: "it is not running" },
  ] });
  assert.equal(p.state, "unknown");
  assert.match(p.why, /none of the 2 installed unit\(s\)/, "the same reason was repeated per unit instead of said once");
  const said = describeConflict(p, move).join("\n");
  assert.match(said, /could not tell/);
  assert.match(said, /writing the move anyway/, "a could-not-look became a silent refusal");
});

test("193 a unit whose ExecStart names no module under the checkout is not guessed at", () => {
  const move = checkoutMove("/old", "/new");
  const p = movePosture({ move, running: [
    { unit: "odd.service", cmdline: cmd("/somewhere"), unitText: "[Service]\nExecStart=/usr/bin/true\n", why: null },
  ] });
  assert.equal(p.state, "unknown", "a unit this code cannot attribute was treated as evidence");
});

test("193 a live process whose command line does not carry its unit's entrypoint is not evidence", () => {
  // A DIFFERENT BRANCH FROM THE ARM ABOVE, and a plant is what proved it. There the UNIT was
  // unattributable — its ExecStart named no module under the checkout. Here the unit is perfectly
  // attributable and the RUNNING command line does not carry that path, so no tree can be read off it.
  // Counting that as looked-at lets a box report a clear coast from a process nobody could place.
  const move = checkoutMove("/old", "/new");
  const p = movePosture({ move, running: [
    { unit: "u.service", cmdline: ["/usr/bin/node", "--eval", "something-else"], unitText: UNIT, why: null },
  ] });
  assert.equal(p.state, "unknown",
    "a process whose tree could not be read was counted as a service confirmed on the destination tree");
});

test("193 no move means no question — the posture short-circuits", () => {
  const p = movePosture({ move: checkoutMove("/same", "/same"), running: [
    { unit: "u.service", cmdline: cmd("/entirely-elsewhere"), unitText: UNIT, why: null }] });
  assert.equal(p.state, "not-moving");
  assert.deepEqual(p.conflicts, [], "a run that moves nothing refused over a tree it was not touching");
});

// ── doctor's half ───────────────────────────────────────────────────────────────────────────────────

test("193 doctor names a program executing a DIFFERENT checkout than the install", () => {
  const r = programsFromAnotherCheckout({
    table: [{ pid: 4242, cmd: `/usr/bin/node /home/testuser/pr43/${REL}` },
      { pid: 4243, cmd: `/usr/bin/node /opt/clearotron/${REL}` }],
    checkoutDir: "/opt/clearotron", entrypoints: [REL] });
  assert.equal(r.state, "elsewhere");
  assert.deepEqual(r.programs.map((p) => p.pid), [4242]);
  assert.equal(r.programs[0].tree, "/home/testuser/pr43");
});

test("193 doctor reports an unread process table as UNKNOWN, never as a clean box", () => {
  // `null` means the instrument did not run. `readOwnProcesses` was rewritten to protect exactly this
  // distinction, and it has to survive the second reader as well as the first.
  const r = programsFromAnotherCheckout({ table: null, checkoutDir: "/opt/clearotron", entrypoints: [REL] });
  assert.equal(r.state, "unknown");
  assert.match(r.detail, /process table/);
});

test("193 doctor says so rather than passing when it has nothing to compare against", () => {
  for (const [args, needle] of [
    [{ table: [], checkoutDir: "", entrypoints: [REL] }, /does not name a checkout/],
    [{ table: [], checkoutDir: "/opt/clearotron", entrypoints: [] }, /no installed unit/],
  ]) {
    const r = programsFromAnotherCheckout(args);
    assert.equal(r.state, "unknown", "a missing input was reported as a clean box");
    assert.match(r.detail, needle);
  }
});

test("193 a box whose programs are all on the install's own tree is current", () => {
  const r = programsFromAnotherCheckout({
    table: [{ pid: 1, cmd: `/usr/bin/node /opt/clearotron/${REL}` }],
    checkoutDir: "/opt/clearotron", entrypoints: [REL] });
  assert.equal(r.state, "current");
  assert.deepEqual(r.programs, []);
});
