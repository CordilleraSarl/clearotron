// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// The unsaved-changes guard, as one mechanism rather than per-screen good intentions.
//
// WHY A REGISTRY AND NOT A PROP. The thing that has to be intercepted is not a prop-drilled callback: it
// is every way out of a screen, and they do not share a parent. In-app navigation goes through the
// shell's `go`, the brand switcher goes through `setOwner` — which is NOT a navigation and is exactly the
// exit the owner reported ("toggle the brand while editing and it just changes") — Back goes through
// popstate, and the Cloudflare Access logout link is a real <a> that leaves the document entirely. A
// screen registers that it is dirty; the shell asks, at every one of those exits, without either side
// knowing about the other.
//
// SCREENS ALREADY KNOW WHEN THEY ARE DIRTY. Brand profile and Brand projects each compute a `dirty` memo
// to enable their Save button, both of the same shape (`JSON.stringify(draft) !== JSON.stringify(base)`).
// This reuses that signal rather than introducing a second, divergeable one — a guard that disagrees with
// the Save button about whether there is work to lose is worse than no guard.
//
// WHAT IT DELIBERATELY DOES NOT DO. It does not block popstate. A popstate listener cannot cancel the
// navigation it is told about; blocking Back honestly needs a sentinel-pushState dance that fights the
// user's own history, and getting it subtly wrong strands people on a page they cannot leave. The
// beforeunload half covers the destructive cases the browser will let us cover (reload, close, logout),
// and Back re-renders a screen whose baseline is refetched — the edit is lost but nothing is saved wrong.
// Stated here so the gap is a decision on the record and not an oversight to be rediscovered.

/** Registered dirty-checkers. A Set so a screen can unregister exactly its own. */
const sources = new Set<() => boolean>()

/** Register a live dirty-checker. Returns the unregister function (call it on unmount). */
export function registerGuard(isDirty: () => boolean): () => void {
  sources.add(isDirty)
  return () => {
    sources.delete(isDirty)
  }
}

/** True if any mounted screen currently holds unsaved work. */
export function hasUnsaved(): boolean {
  for (const s of sources) {
    try {
      if (s()) return true
    } catch {
      // A checker that throws is a screen mid-render, not a reason to lose someone's work: treat an
      // unanswerable question as "there might be something", which is the safe direction here.
      return true
    }
  }
  return false
}

/**
 * Ask before leaving, if there is anything to lose. `true` means go ahead.
 *
 * The wording names the work rather than the mechanism — "changes you have not saved", not "unsaved form
 * state" — and it says where the changes are going, because the two exits this guards feel completely
 * different to the person taking them: one is a menu click, the other is a dropdown at the top of the
 * page that does not look like it leaves anything.
 */
export function confirmDiscard(what = 'Leave this page?'): boolean {
  if (!hasUnsaved()) return true
  return window.confirm(`${what}\n\nYou have changes here that have not been saved. They will be lost.`)
}

/** Wire the browser-level half: reload, tab close, and the Access logout link. Returns a detach fn. */
export function attachBeforeUnload(): () => void {
  const on = (e: BeforeUnloadEvent) => {
    if (!hasUnsaved()) return
    // The only portable way to ask: set returnValue and preventDefault. Browsers show their own wording
    // and ignore ours, which is why the in-app confirm above carries the sentence that matters.
    e.preventDefault()
    e.returnValue = ''
  }
  window.addEventListener('beforeunload', on)
  return () => window.removeEventListener('beforeunload', on)
}
