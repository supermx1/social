# LinkedIn posting recon — ego-browser run

**Date:** 2026-08-08
**Method:** ego-browser task space `linkedin posting recon`, against the live logged-in session.
**Scope:** author identity (personal vs company pages), composer, media upload, draft persistence.
**Not yet done:** publishing. No post has been made — the confirmation/permalink mechanism is unknown.

## The headline: identity comes from the URL, not from a control

This is the single most important difference from X, and it is a **safety improvement**. On X the
target account is selected by clicking a switcher and polling until it lands (§2.3 of the design
doc) — a step that can silently fail and publish under the wrong brand. On LinkedIn the author is
fixed by the URL *before the composer exists*, so there is no switch step and no race.

Verified live, all three:

| URL | Resulting author |
|---|---|
| `https://www.linkedin.com/company/107591805/admin/page-posts/published/?share=true` | **Kasa** |
| `https://www.linkedin.com/company/112229576/admin/page-posts/published/?share=true` | **TechGFX Technologies Limited** |
| `https://www.linkedin.com/preload/sharebox/` | **Chukwuemeka Anyakora** (personal) |

Company page ids come from the "My pages" rail on the feed (`a[href*="/company/"]`).

The guard therefore becomes a pure **read-and-verify** — read the author out of the open composer
and abort if it isn't the expected one — with no switching to attempt or retry.

## Verified selectors

LinkedIn is much more hostile than X. The feed page's share trigger carries only **obfuscated
hashed classes** (`_8ba049e9 f1598412 …`) and there are just 12 `data-testid`s on the whole feed,
none on the composer. But **inside the composer modal** LinkedIn uses its semantic `artdeco` /
`share-*` design-system classes, which are stable and meaningful.

| Purpose | Selector | Verified |
|---|---|---|
| **Composer modal** | `[role="dialog"][aria-labelledby="share-to-linkedin-modal__header"]` | yes |
| Author identity | `.share-unified-settings-entry-button` → first line of `innerText` | yes — "Kasa", "TechGFX Technologies Limited", "Chukwuemeka Anyakora" |
| Audience | same element, second line | yes — "Post to Anyone" |
| Editor | `[role="textbox"]`, `aria-label="Text editor for creating content"` | yes |
| Post button | `.share-actions__primary-action` | yes — `disabled` until the editor has text |
| Schedule post | `.share-actions__scheduled-post-btn` | present (LinkedIn has native scheduling) |
| Add media | `[aria-label="Add media"]` | yes |
| Media file input | `input[type="file"]` — **only exists after clicking Add media** | yes; accepts image/* + video/*, `multiple` |
| Media confirm | button with text `Next` | yes |
| Uploaded file check | `button[aria-label^="Select "]` — the label echoes the real filename | yes |
| Remove media | button with text `Remove media` | yes (composer, after attaching) |
| Close | `button[aria-label="Dismiss"]` | present, but see trap #2 |

**Do NOT use `ember###` ids.** Several buttons carry them (`ember90`, `ember123`, …). They are
Ember-generated, change on every render, and are worthless as selectors.

## Traps

**1. A bare `[role="dialog"]` is not the composer.** LinkedIn keeps other dialogs in the DOM —
parking on `/feed/` leaves a `[role="dialog"]` whose text is just "This is a modal window."
(the messaging overlay). Matching any dialog would read the wrong element and, worse, could pass
an author check by accident. Always scope to `aria-labelledby="share-to-linkedin-modal__header"`.
This is LinkedIn's equivalent of the unscoped-`UserCell` trap in the X recon.

**2. In-page Dismiss did not close the composer.** Clicking `[aria-label="Dismiss"]` left the
modal open with its content intact, across two attempts. Navigating away (`gotoAndWait`) discarded
it reliably — the same lesson as X, where real navigation was what actually cleared state.

**3. Media is a two-step flow, not one.** `Add media` opens a *sub*-dialog ("Select files to
begin"); the `input[type="file"]` only exists at that point. After `uploadFile` you must click
`Next` to return to the composer. Only then is the image attached to the post.

## Better than X: the composer opens clean

Re-opening `?share=true` after discarding a draft gave an **empty editor, no media, Post disabled**.
LinkedIn does not retain the previous draft, so the explicit clear-before-typing step that X needs
(design doc §2.x — `typeText` inserts at the cursor, so a stale draft gets spliced into the new
one) is **not** required here. Do not copy that workaround over blindly.

## Verified flow (up to, but excluding, publish)

```
goto   <identity URL>?share=true          # identity is fixed here
wait   for [role="dialog"][aria-labelledby="share-to-linkedin-modal__header"]
guard  read .share-unified-settings-entry-button -> must equal the expected author, else abort
click  [role="textbox"]                   # focus
type   <body>                             # real keystrokes
read   [role="textbox"].innerText         # confirm it landed
--- if media ---
click  [aria-label="Add media"]
upload input[type="file"] <absolute path>
verify button[aria-label^="Select "] shows the filename
click  Next                               # returns to composer with image attached
--- end media ---
guard  read the author again              # immediately before the irreversible click
click  .share-actions__primary-action
???    confirmation / permalink — UNKNOWN, needs a real post to establish
```

## Open questions before this can ship

- **Post confirmation and permalink.** X gives a toast carrying the absolute post URL, which is
  where `posts.post_url` comes from. LinkedIn's equivalent is unknown and can only be found by
  publishing once for real.
- **Schema.** `accounts` currently has `platform` + `handle`. A LinkedIn account needs to record
  *which identity* to post as — a company id (`107591805`) or "personal". `handle` alone cannot
  express that, so this needs a field or a convention.
- **Native scheduling.** LinkedIn has its own `Schedule post` control. Worth deciding whether to
  use it or keep everything on our scheduler; using theirs would mean the post leaves our
  control once queued.
- **Multi-image and video.** The file input accepts both and is `multiple`; only a single image
  was exercised.
