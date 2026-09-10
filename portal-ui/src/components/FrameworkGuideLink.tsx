// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// ONE LINK TO THE FRAMEWORK GUIDE, for every screen that offers it.
//
// It was written out on the create form and nowhere else, and the owner found three things wrong with
// it on one walk: it navigated the person AWAY from the form they were filling in, it landed at the top
// of a long configuration document rather than at the part about writing a framework, and it vanished
// entirely when the deployment could not name its own repository — so the one route to that capability
// disappeared without a word.
//
// A NEW TAB, because the reader is mid-task on both screens that show this. The form keeps its state and
// the profile keeps its scroll.
//
// THE REPOSITORY IS THE ONE THE SERVER NAMES, never a literal: this portal may be a fork, and a link to
// somebody else's instructions is worse than none — it describes a product the reader is not running.
//
// AND WHEN IT CANNOT BE NAMED, SAY WHERE THE FILE IS. Rendering nothing was the old behaviour and it is
// the one that taught nobody anything: a reader who cannot see the link cannot know the capability
// exists. The path is true of every copy of the product, fork or not.
import { useEffect, useState } from 'react'
import { api, isOk } from '../contract/api.ts'
import { GUIDE_PATH, GUIDE_ANCHOR } from '../contract/frameworkGuide.ts'


export function FrameworkGuideLink({ label = 'Use your own risk framework' }: { readonly label?: string }) {
  const [repo, setRepo] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    void api.about().then((r) => { if (live && isOk(r)) setRepo(r.value.sourceRepo) })
    return () => { live = false }
  }, [])

  if (!repo) {
    return (
      <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>
        {label}: see <code>{GUIDE_PATH}</code> in the product source.
      </span>
    )
  }
  return (
    <a
      href={`${repo}/blob/main/${GUIDE_PATH}#${GUIDE_ANCHOR}`}
      target="_blank"
      rel="noreferrer"
      style={{ fontSize: 13 }}
    >
      {label}
    </a>
  )
}
