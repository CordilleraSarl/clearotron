// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// Which checkout is a service actually serving?
//
// The deployment check answers that by asking systemd for a unit's `WorkingDirectory` and running git
// there. That works for a unit whose WorkingDirectory is a checkout, and a great many units are not
// written that way — because systemd cannot expand a variable in `WorkingDirectory=` and can in
// `ExecStart=`, so the ordinary shape puts the checkout in `ExecStart=` and leaves WorkingDirectory as
// the home directory. Every such unit dropped out of the comparison, and the check reported that it had
// nothing of this deployment's to compare — correctly, and uselessly.
//
// The fixtures below are that shape, taken from four services measured on a real deployment:
//
//   WorkingDirectory=~                  → systemd renders it `!/srv/example` — not a checkout
//   ExecStart=/usr/bin/node ${CLEAROTRON_CHECKOUT_DIR}/driver/portal-service.mjs
//   /proc/<pid>/cmdline                 → /usr/bin/node /srv/example/app/driver/portal-service.mjs
//
// The unit file says WHICH module to look for; the live process says WHERE that module came from. Both
// readers already existed — this asserts they compose, and that the composition prefers the observation
// over the declaration.
import test from "node:test";
import assert from "node:assert/strict";
import { unitClone, unitWorkingDirectory } from "../unit-inventory.mjs";
import { entrypointOf } from "../systemd/install-census.mjs";
import { treeOfRunning } from "../../shared/checkout-move.mjs";

// The shape measured on the box, with the operator's home transposed to /srv — a `/home/<name>/` literal
// in a fixture is what the deployment-hostname guard exists to refuse.
const UNIT_TEXT = [
  "[Service]",
  "Type=simple",
  "EnvironmentFile=%h/.env",
  "Environment=CLEAROTRON_NO_ENV_FILE=1",
  "ExecStart=/usr/bin/node ${CLEAROTRON_CHECKOUT_DIR}/driver/portal-service.mjs",
  "Restart=on-failure",
  "",
].join("\n");
// `/proc/<pid>/cmdline` is NUL-separated and NUL-terminated, which is what the real file hands back.
const CMDLINE = "/usr/bin/node\0/srv/example/app/driver/portal-service.mjs\0";
const TREE = "/srv/example/app";

test("the shape on the box: WorkingDirectory names no checkout, and that is the ordinary case", () => {
  // `WorkingDirectory=~` is rendered `!/srv/example`. The `!` is systemd's marker; the path behind it is
  // a home directory. It parses to a path — so the old reader handed it to git, which is where the
  // `fatal: not a git repository` in the deploy journal came from — and it is not a checkout.
  const parsed = unitWorkingDirectory("!/srv/example");
  assert.equal(parsed.path, "/srv/example", "the prefix comes off and a real path is returned");
  assert.notEqual(parsed.path, TREE, "…and it is NOT the tree the service is running, which is the whole problem");
});

test("the unit file names the module, and the running process names the tree it came from", () => {
  const { rel, unreadable } = entrypointOf(UNIT_TEXT);
  assert.equal(unreadable, null);
  assert.equal(rel, "driver/portal-service.mjs", "the ExecStart parser reads the module out of the unexpanded path");
  const { tree, why } = treeOfRunning(CMDLINE, rel);
  assert.equal(why, null);
  assert.equal(tree, TREE, "and the live argv — where the variable IS expanded — gives the checkout");
});

test("a unit attributable only by its process is attributed, not dropped", () => {
  // The regression this file exists for: before, this unit contributed nothing and the check reported
  // "no unit reported a WorkingDirectory inside <clone>" for every service on the box.
  const { rel } = entrypointOf(UNIT_TEXT);
  const { tree } = treeOfRunning(CMDLINE, rel);
  const chosen = unitClone({ declaredTree: null, runningTree: tree, declaredWhy: "the unit reported no WorkingDirectory" });
  assert.equal(chosen.clone, TREE);
  assert.equal(chosen.source, "the running command line", "and it says which evidence answered");
});

test("THE STRADDLE — the running tree wins over the declaration, and the difference is reported", () => {
  // The incident this comparison exists for: a deployment served its portal from one clone and ran its
  // runner from another for weeks. In that state the declaration and the process disagree and the
  // PROCESS is telling the truth, so preferring the declaration would take the wrong side of exactly the
  // case the check is for.
  const chosen = unitClone({ declaredTree: "/srv/example/old", runningTree: TREE });
  assert.equal(chosen.clone, TREE, "the observation must win over the declaration");
  assert.equal(chosen.source, "the running command line");
  assert.match(chosen.disagreement, /declares \/srv\/example\/old/, "the disagreement must name the declared tree");
  assert.match(chosen.disagreement, /started from \/srv\/example\/app/, "…and the one it is actually running");
});

test("the declaration is still used when there is no process to observe", () => {
  const chosen = unitClone({ declaredTree: TREE, runningTree: null, runningWhy: "the unit reported no MainPID" });
  assert.equal(chosen.clone, TREE);
  assert.equal(chosen.source, "WorkingDirectory", "a stopped unit is still attributable by what it declares");
  assert.equal(chosen.disagreement, null, "one source cannot disagree with itself");
});

test("a trailing slash is not a disagreement", () => {
  // Two readers of one path, one of which came from `git rev-parse --show-toplevel` and one from an
  // argv, is exactly where a spurious "these differ" comes from.
  const chosen = unitClone({ declaredTree: `${TREE}/`, runningTree: TREE });
  assert.equal(chosen.disagreement, null);
  assert.equal(chosen.clone, TREE);
});

test("when neither answers, the reason names BOTH halves", () => {
  // A reader told only "no WorkingDirectory" goes and edits a unit file when the process table was the
  // half that could not be read. Both reasons, or the sentence sends them to the wrong place.
  const chosen = unitClone({
    declaredWhy: "the unit reported no WorkingDirectory",
    runningWhy: "/proc/41/cmdline could not be read: EACCES",
  });
  assert.equal(chosen.clone, null);
  assert.match(chosen.why, /WorkingDirectory/);
  assert.match(chosen.why, /cmdline could not be read/);
});

test("with no evidence at all it still says something a reader can act on", () => {
  const chosen = unitClone({});
  assert.equal(chosen.clone, null);
  assert.match(chosen.why, /neither/, "an empty result must not be an empty sentence");
});

test("a unit whose ExecStart names no module under the checkout is refused, not guessed at", () => {
  // A shell unit, or one invoking an absolute path that is not under the checkout variable. Attributing
  // it by the first absolute-looking argument would put a unit belonging to something else inside this
  // deployment's comparison, which is worse than not comparing it.
  const { rel, unreadable } = entrypointOf("[Service]\nExecStart=/bin/bash /srv/example/tool.sh\n");
  assert.equal(rel, null);
  assert.match(unreadable, /does not name a module/);
  assert.equal(unitClone({ runningWhy: unreadable }).clone, null);
});

test("a relative argv is refused — the tree cannot be derived from it", () => {
  // `treeOfRunning` takes absolute paths only, because a relative argv resolves against a cwd this
  // reader cannot see. A tree derived from the wrong base would be a confident wrong answer.
  const { tree, why } = treeOfRunning("/usr/bin/node\0driver/portal-service.mjs\0", "driver/portal-service.mjs");
  assert.equal(tree, null);
  assert.match(why, /absolute path/);
});
