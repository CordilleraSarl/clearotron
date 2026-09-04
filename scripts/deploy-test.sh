#!/bin/bash
# deploy-test.sh — bring the TEST instance up to origin/main. Nobody types git pull.
#
# The dev→test→prod rule this implements: TEST auto-deploys from main; PROD never auto-deploys.
# Test is allowed to break — that is its job — so this needs no approval. Prod still moves only when
# Krzys says so.
#
# Refuses to act while a run is in flight: restarting services mid-run is how you turn a clearance into
# a stranded one, and the whole point of this instance is to observe runs to completion.
# ── #1381: THIS FILE IS THE MASTER COPY, AND UNTIL NOW THERE WAS NOT ONE ────────────────────────────
#
# This script runs the test instance's only automatic deployment, hourly, and it was tracked in no
# repository at all. What stood in for version control was four backup files beside it, each from a
# different lane:
#
#     deploy-test.sh.bak-pre-375-20260804-202628      42 lines
#     deploy-test.sh.bak-pre-405-20260805-094520      71 lines
#     deploy-test.sh.bak-eggface-20260819             97 lines
#     deploy-test.sh.bak-ud2-20260819                129 lines
#
# Four editors, no history, no review, and no diff anybody can read after the fact — while the file
# encodes decisions that were expensive to learn: the in-flight refusal (#375), the store sync running
# before the early exit (#405), the arrival gate (#1217), the detached-HEAD refusal and the ERR trap
# (#1353). None of that survives a VM rebuild or a home-directory restore, and one lane overwriting
# another announces itself only as the deploy behaving differently.
#
# ── WHY THE PATHS ARE PARAMETERS AND NOT THE LITERALS THE BOX RUNS ───────────────────────────────────
#
# The live copy names `/home/testuser` in four places. #644 forbids exactly that in tracked code — it is
# wrong under every other service account and in every public clone — and the only reason its guard did
# not already refuse this file is that the guard's walker reads .mjs/.js/.ts/.yml/.service and had never
# needed to read .sh. Tracking this verbatim would have put an operator's home into the repository
# through a blind spot rather than past a check. The walker now reads .sh too; see
# driver/test/deployment-hostnames.test.mjs.
#
# So the three locations are env-overridable and default off `$HOME`, which is generic: under the
# service account that runs the timer, $HOME resolves to exactly what the literals said.
#
# ── THE BOX RUNS A COPY DEPLOYED FROM THIS ONE, AND WHY IT IS A COPY ─────────────────────────────────
#
# #1381 asks for two things that turn out to conflict: the box running "a copy deployed from the repo
# rather than the master copy", and ExecStart pointing "at the tracked path". Step 5 does the first.
# The second cannot be done, and the reason is a hazard rather than a preference — see step 5.
#
# The precondition the first half of #1381 wrote for this step — "after the drift check has been quiet
# for a few ticks" — was UNSATISFIABLE and is withdrawn. The check ships in this file; the box ran the
# untracked copy, which never carried it. It had not run once in eight ticks, and its silence read
# exactly like agreement. A precondition only measurable after the act it gates is not a gate. What
# stood in for those quiet ticks: the two copies were diffed line-set against each other and differ by
# the four $HOME literals, their parameterisation and the drift-check block — nothing else, no lane's
# unrecorded edit. That is a stronger answer than quiet ticks could ever have given.
#
# Until then the box's copy is authoritative and this one is the reference — which the drift check will
# say out loud on its first run, because they differ by exactly the parameterisation above.

set -euo pipefail

# The three locations this script needs, none of them naming an account (#644/#1381). Defaults are off
# $HOME so the timer's own service account supplies them; override to run it anywhere else.
REPO_DIR="${DEPLOY_TEST_REPO:-$HOME/clearotron}"
QUEUE="${DEPLOY_TEST_QUEUE:-$HOME/trademark-test/queue}"
ENV_FILE="${DEPLOY_TEST_ENV:-$HOME/.env}"

cd "$REPO_DIR"

log() { echo "[deploy-test] $*"; }

# A FAILED TICK SAYS SO, IN THIS SCRIPT'S VOICE (#1353). Without this, `set -e` exits silently and the
# only thing separating a red tick from a healthy SKIP is the unit's exit code, which nobody reads.
#
# The premise the issue was filed on was WRONG and the correction matters: the failing command's stderr
# DOES reach the journal — measured on the 14:00 tick of 2026-08-19, where git printed "You are not
# currently on a branch." in full. It arrives under the CHILD's PID with no [deploy-test] prefix, so
# anyone reading this script's own lines sees an abrupt stop and no reason, and concludes nothing was
# logged. An absence in a filtered view is not an absence.
#
# DISARMED AROUND EVERY DELIBERATE `set +e`, and that is not optional: the ERR trap fires even when
# `set -e` is off, so an armed trap would kill the script on the store sync's refusal — which this file
# already documents as that sync's NORMAL state. Measured before installing; it would have stopped every
# deploy on this box.
arm_err() { trap 'rc=$?; log "FAILED at line $LINENO (rc=$rc): ${BASH_COMMAND}"; log "        that command'"'"'s own error is in the journal just above, under the child PID"; exit $rc' ERR; }
arm_err

# 5 — INSTALL THIS COPY AS THE ONE THE BOX RUNS NEXT TICK (#1381). Defined here, called from the two
#     places a tick can succeed: the "already current" exit and the end of a healthy deploy.
#
#     WHY ExecStart POINTS AT A DEPLOYED COPY AND NOT AT THIS FILE. Bash reads a running script LAZILY,
#     by byte offset. A `git pull` that rewrites the file bash is executing makes it resume at its old
#     offset inside the NEW bytes. Measured 2026-08-20 in a sandbox: the run executed a fragment of a
#     line (`ho: command not found`) and then a whole line the original file never contained. A unit
#     pointed at this path would be one deploy away from running spliced commands, so #1381's row asking
#     for exactly that is refused on evidence. What that row WANTED — "so the two cannot silently
#     diverge" — is this step plus the drift check at step 0, which is the honest way to get it.
#
#     RENAME, NEVER COPY-IN-PLACE, for the same reason. `cp` over the target truncates and rewrites the
#     same inode — the hazard above. `mv` swaps the directory entry and leaves the running shell's inode
#     alone; the same reproduction then ran clean through its own last line. The temp file is created
#     beside the target so the rename stays inside one filesystem and is therefore atomic.
#
#     WHAT THE DRIFT CHECK MEASURES AFTER THIS. Not a file against itself: `$0` is the deployed copy,
#     the reference is this tracked one. Steady state is "same"; it reports drift for the tick after a
#     commit changes this file, for a hand-edit on the box, and for a self-install that failed. It still
#     reports "unreadable" separately, which is the state that mattered most.
#
#     NON-FATAL AND LOUD. A failed self-install must not fail a deploy that already passed its health
#     check, and must not pass quietly either — quietly is how the box stops tracking the repo with
#     nobody told. Called through `if !` so errexit is suspended for the call and the ERR trap, which
#     functions do not inherit without `set -E`, cannot turn a failed copy into a dead tick. Verified
#     both halves in a sandbox before relying on them.
install_self() {
  local target tmp
  target="${DEPLOY_TEST_SELF:-$0}"
  case "$target" in /*) ;; *) target="$PWD/$target" ;; esac
  [ "$target" = "$REPO_DIR/scripts/deploy-test.sh" ] && return 0        # run by hand from the checkout
  if [ ! -f "$target" ]; then
    log "self-install: $target does not exist — NOT creating it, because the unit's ExecStart decides"
    log "             where the deployed copy lives and inventing one here would fork that decision"
    return 1
  fi
  cmp -s "$REPO_DIR/scripts/deploy-test.sh" "$target" && return 0       # already identical: the normal tick
  tmp="$target.installing.$$"
  cp "$REPO_DIR/scripts/deploy-test.sh" "$tmp" || { rm -f "$tmp"; return 1; }
  chmod --reference="$target" "$tmp" 2>/dev/null || chmod 0775 "$tmp"
  mv "$tmp" "$target" || { rm -f "$tmp"; return 1; }
  log "self-install: $target refreshed from scripts/deploy-test.sh — the NEXT tick runs it; this one"
  log "             finishes on the old inode, which is why the swap is a rename and not a copy"
  return 0
}
say_install_failed() {
  log "SELF-INSTALL FAILED — the box is no longer tracking scripts/deploy-test.sh, and the only thing"
  log "                     that will keep saying so is the drift check at step 0 of the next tick"
}

# 0 — AM I THE SCRIPT THE REPOSITORY THINKS I AM? (#1381)
#
#     Reported, never enforced and never reconciled. A deploy that refuses because its own source drifted
#     is a deploy that cannot be hotfixed in an incident, and one that silently copies either file over
#     the other loses somebody's deliberate edit. So this states the fact and carries on.
#
#     NON-FATAL BY CONSTRUCTION: `|| true`, because the ERR trap is armed here and a drift exit of 1 is
#     an ordinary answer, not a failure of the deploy.
#
#     EXPECT "same" ON A STEADY TICK, now that step 5 installs this file as the box's copy. Drift is a
#     real answer again rather than a standing condition: the tick after a commit changes this file, a
#     hand-edit on the box, or a self-install that failed. It is reported BEFORE step 5 replaces the
#     box's copy, so an edit somebody made by hand is announced on the tick that overwrites it — which
#     is the only way "reports, never reconciles" and "the box tracks the repo" can both be true.
if [ -f scripts/deploy-drift-check.mjs ]; then
  while IFS= read -r l; do [ -n "$l" ] && log "$l"; done <<< "$(node scripts/deploy-drift-check.mjs --deployed "${DEPLOY_TEST_SELF:-$0}" 2>&1 || true)"
fi

# 1 — never mid-run. The driver decides what "live" means, not a grep in this file (#375).
#     This counted .json and .processing and NOT .postponed, so it refused correctly twice while R1 was
#     executing on 2026-08-04, then deployed ten seconds after the run PARKED — the count went to zero, the
#     services restarted, and the run resumed 110 seconds later on a different commit. One clearance spanning
#     two builds, with nothing in its record saying so. A park is a live run: both the rate-limit park and the
#     recovery park auto-resume.
#
#     scripts/queue-inflight.mjs is in the checkout we are about to update, so it is read BEFORE the pull —
#     the guard that decides whether to deploy must not come from the deploy.
#
#     BOOTSTRAP: the script arrives WITH the commit that adds it, so on a checkout older than that commit
#     it is simply absent. That is not a fault and must not wedge the deploy — fall back to the pattern,
#     with .postponed in it. The fallback is the thing being replaced, so it carries the fix too.
if [ -f scripts/queue-inflight.mjs ]; then
  if ! INFLIGHT=$(node scripts/queue-inflight.mjs "$QUEUE"); then
    log "REFUSING — could not read the queue to check for live runs; deploying over a live run is what this guard exists to prevent"
    exit 1
  fi
  LIVE=$(node scripts/queue-inflight.mjs --names "$QUEUE" | tr '\n' ' ')
else
  INFLIGHT=$(ls "$QUEUE" 2>/dev/null | grep -cE '\.(json|processing|postponed)$' || true)
  # `|| true`, and it is load-bearing: under `set -o pipefail` a grep that matches nothing returns 1, the
  # assignment inherits it, and `set -e` kills the script silently at exit 0 — the deploy would simply
  # stop happening, saying nothing. That is the failure class this whole issue is about.
  LIVE=$(ls "$QUEUE" 2>/dev/null | grep -E '\.(json|processing|postponed)$' | tr '\n' ' ' || true)
  log "note: scripts/queue-inflight.mjs not in this checkout yet — using the inline pattern for this tick"
fi
if [ "$INFLIGHT" != "0" ]; then
  log "SKIP — $INFLIGHT job(s) queued, in flight or parked: $LIVE"
  exit 0
fi

# 2a — the E2E CONFIG STORE (#405). It moves independently of this repo and nothing pulled it, and it is
#      what decides what a round MEASURES: every scenario's assertions and every gold set live there.
#      An out-of-date PRODUCT checkout fails loudly; an out-of-date CONFIG store fails as an assertion
#      that quietly does not exist, which reads exactly like an assertion nobody wrote.
#      This runs BEFORE the early exit below on purpose — the store moves on ticks where the product does
#      not, and an early exit would skip it on precisely those ticks.
#      `set -e` is ON in this script, and a command substitution that exits non-zero aborts it. The sync
#      exits 1 on a refusal — which is its NORMAL state until the store gets an owner that can pull — so
#      without disarming -e around it, every tick would abort here and the product would stop deploying,
#      silently, with the health check below never reached.
trap - ERR; set +e
if [ -f scripts/sync-e2e-store.mjs ]; then
  STORE_OUT=$( set -a; . "$ENV_FILE"; set +a; node scripts/sync-e2e-store.mjs 2>&1 )
  STORE_RC=$?
else
  # The script arrives WITH the product pull below, so the first tick after it merges has not got it yet.
  # Say that plainly rather than logging a MODULE_NOT_FOUND stack every hour.
  STORE_OUT="store sync script not in this checkout yet — it lands with the pull below"
  STORE_RC=0
fi
set -e; arm_err
while IFS= read -r l; do [ -n "$l" ] && log "$l"; done <<< "$STORE_OUT"
if [ "$STORE_RC" != "0" ]; then
  log "store sync did NOT complete (rc=$STORE_RC) — a round starting now measures whatever was last pulled by hand"
fi

# 2 — never a merge. --ff-only means a diverged clone fails loudly instead of inventing a merge commit
#     (the #81 divergence trap: prod once carried three commits that existed in no repo).
# 2z — ON A BRANCH AT ALL (#1353). The divergence guard below asks "has my clone diverged" and the
#      arrival gate asks "how did the tip get there". NEITHER asks whether this checkout is on a branch,
#      and a detached HEAD passes both: `merge-base --is-ancestor` is happy, and then `git pull` refuses
#      with "You are not currently on a branch."
#
#      This is not hypothetical. On 2026-08-19 someone checked out bf71591a out of band at 11:39, the
#      14:00 tick died on it, and a human put it back at 14:01 — the reflog carries all three. Every tick
#      in between would have failed the same way. Cheap to detect, so detect it.
if ! git symbolic-ref -q HEAD >/dev/null; then
  log "REFUSING — this checkout is on a DETACHED HEAD at $(git rev-parse --short HEAD), so nothing can fast-forward."
  log "          Someone checked out a commit here out of band and left it. Put it back with: git checkout main"
  log "          Deploys stay stopped until then — every tick fails identically, so this is worth one look now."
  exit 1
fi

BEFORE=$(git rev-parse HEAD)
git fetch --quiet origin main
if ! git merge-base --is-ancestor HEAD origin/main; then
  log "REFUSING — this clone is not an ancestor of origin/main. It has diverged; a human should look."
  exit 1
fi
# 2b — HOW THE TIP ARRIVED (#1217). `--ff-only` and the ancestor check above both ask the same question,
#      "has MY CLONE diverged", and neither asks how origin/main's tip got there. On 2026-08-18 a feature
#      branch was pushed AS main: ungated engine and provider files, and a clean fast-forward from where
#      this box sat. Both guards would have waved it through; a manual timer stop is the only reason they
#      did not. scripts/head-arrived-gated.mjs answers the missing question and exits 0/1/2.
#
#      UNKNOWN REFUSES, deliberately. The script's own contract leaves the decision to the caller and says
#      an unanswerable question is not a pass. A refusal here costs one hour and is visible as a failed
#      unit; accepting an ungated head costs every coverage claim the next round makes, and reads green.
#
#      BOOTSTRAP, same rule as queue-inflight.mjs above: on a checkout older than the commit that adds the
#      script it is simply absent. Absence of the script is not evidence about the head — say so, carry on.
TIP=$(git rev-parse origin/main)
if [ -f scripts/head-arrived-gated.mjs ]; then
  trap - ERR; set +e
  ARRIVAL_OUT=$(node scripts/head-arrived-gated.mjs "$TIP" 2>&1)
  ARRIVAL_RC=$?
  set -e; arm_err
  while IFS= read -r l; do [ -n "$l" ] && log "$l"; done <<< "$ARRIVAL_OUT"
  if [ "$ARRIVAL_RC" = "1" ]; then
    log "REFUSING — origin/main's tip ${TIP:0:8} did NOT arrive as a gated merge. It was pushed straight to the branch."
    log "          Nothing ungated lands on this box. Get it onto a branch and through a PR, or say why it is safe."
    exit 1
  fi
  if [ "$ARRIVAL_RC" != "0" ]; then
    log "REFUSING — could not establish how ${TIP:0:8} arrived (rc=$ARRIVAL_RC). Not knowing is not a pass."
    exit 1
  fi
else
  log "note: scripts/head-arrived-gated.mjs not in this checkout yet — how the tip arrived was NOT checked this tick"
fi

# MERGE THE REF THIS TICK ALREADY DECIDED ON — never a second fetch (#1486).
#
# This was `git pull --ff-only`, and a pull is fetch-then-merge. That second fetch cost two things:
#
#   1. THE ARRIVAL GATE WAS BYPASSABLE. `TIP` is read from origin/main above and every refusal in this
#      block is a judgment about THAT commit. A pull then fetches again and merges whatever it lands, so
#      a commit pushed between the gate and here was deployed WITHOUT being gated — the one thing this
#      block exists to prevent. Merging `origin/main` merges the ref the gate actually inspected.
#
#   2. IT RACED EVERY OTHER READER OF THIS CLONE. `git pull` writes FETCH_HEAD, and any concurrent
#      `git fetch` here can leave two for-merge entries in that file; the merge then dies with
#      `fatal: Cannot fast-forward to multiple branches` and the tick is lost. Observed 2026-08-21 at
#      07:00 CEST, exit 128 at this line, while seven agent sessions were starting. A merge of a named
#      ref does not touch FETCH_HEAD at all, so the shared file the race is fought over stops being
#      part of this path.
#
# The duplicate is NOT sticky — a pull's own fetch rewrites FETCH_HEAD before the merge resolves — so
# the failure needs an external fetch landing inside a sub-second window. That is why this must be
# closed in CODE and can never be certified by absence of recurrence: it will look fixed either way.
git merge --ff-only --quiet origin/main
AFTER=$(git rev-parse HEAD)
if [ "$BEFORE" = "$AFTER" ]; then
  log "already current at ${AFTER:0:8}"
  # Here as well as at the end, so a hand-edit on the box is corrected within the hour rather than
  # waiting for whenever the next commit happens to arrive. This is the common tick.
  if ! install_self; then say_install_failed; fi
  exit 0
fi
log "$( git log --oneline "$BEFORE..$AFTER" | wc -l ) new commit(s): ${BEFORE:0:8} → ${AFTER:0:8}"

# 3 — deps, then restart. Never --omit=dev: portal-service serves a COMMITTED bundle, and dropping
#     devDependencies is how a deploy starts serving a stale one with no error at all.
npm ci --no-audit --no-fund --silent
systemctl --user daemon-reload
systemctl --user restart trademark-ops-mcp trademark-portal
sleep 4

# 4 — prove it, or say so. A deploy that does not check is a deploy that discovers its own failure later.
set -a; . "$ENV_FILE"; set +a
if node scripts/live-surface-check.mjs; then log "deployed and healthy at ${AFTER:0:8}"
else log "DEPLOYED at ${AFTER:0:8} but the health check FAILED — see above"; exit 1; fi

# Reached only on the healthy branch — the other one exits. A script that installs itself out of a tree
# whose health check just failed is how a bad deploy becomes the permanent one.
if ! install_self; then say_install_failed; fi
