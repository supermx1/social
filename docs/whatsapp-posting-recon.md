# WhatsApp Status posting recon — ego-browser run

**Date:** 2026-08-09
**Method:** ego-browser against the live logged-in WhatsApp Web session (delegated recon).
**Scope:** the image + caption Status flow, up to but excluding Send. Nothing was posted.

## What makes WhatsApp different from X and LinkedIn

**There is no identity to get wrong.** WhatsApp Web is one account with one identity — no account
switcher (X) and no company-vs-personal choice (LinkedIn). The whole class of "published under the
wrong brand" bugs does not exist here, so there is no author guard. The only session question is
whether we are logged in at all.

**A Status is not a post.** It expires after 24 hours and has no permalink, so `posts.post_url`
stays empty for WhatsApp. That is correct behaviour, not a missing feature — do not go looking for
a URL to capture the way LinkedIn's `data-urn` was found.

**The hooks are good.** Unlike LinkedIn's obfuscated classes, WhatsApp Web still ships
unobfuscated `data-testid` and `data-icon` attributes, plus meaningful `aria-label`s.

## Verified selectors

| Purpose | Selector | Verified |
|---|---|---|
| Logged in | `button[aria-label="Chats"]` present and no QR canvas | yes |
| Status tab | `button[aria-label="Status"]` | yes — clicked |
| Open the status-type menu | `button[aria-label="Add Status"]` | yes |
| Image/video status | `button[aria-label="Photos & videos"]` | yes |
| Text status | `button[aria-label="Text"]` | exists; **never opened** |
| File input | `input[type="file"]` — **only mounts after "Photos & videos"** | yes; `accept="image/*,video/mp4,video/3gpp,video/quicktime"`, `multiple` |
| Caption | `[data-testid="media-caption-input-container"]` — a contenteditable, not an `<input>` | yes — typed text landed |
| Send | `[aria-label="Send 1 selected"]` | selector yes; **never clicked** |
| Send enabled state | `aria-disabled="false"` on that element | yes (with media staged) |
| My status entry | `[data-testid="status-header"]` | exists pre-post; post-publish appearance unverified |

## Traps

**1. Send is a `<div>`, not a `<button>`.** Reading `.disabled` on it returns `undefined`
regardless of the true state, so a naive enabled-check always looks "enabled". `aria-disabled` is
the attribute that actually reflects state.

**2. The file input does not exist until "Photos & videos" is clicked.** Querying for it straight
after "Add Status" returns nothing, which reads as "there is no upload path". Same lazy-mount
pattern as LinkedIn's "Add media".

**3. The send label encodes the file count.** `Send 1 selected` — a multi-image status would carry
a different label, so matching on the literal string only holds for the single-image case. Match
on the `Send ` prefix, not the whole string.

**4. Status list DOM contains private data.** The Status tab lists contacts' names and status
previews. Any DOM probe run while it is open must be scoped to the composer subtree; a broad
query will pull personal data into tool output. (This happened during recon and was contained.)

## Verified flow (up to, but excluding, Send)

```
check  button[aria-label="Chats"] exists, no QR canvas   # logged in
click  button[aria-label="Status"]
click  button[aria-label="Add Status"]
click  button[aria-label="Photos & videos"]              # mounts the file input
upload input[type="file"] <absolute path>
wait   for the media editor to render
click  [data-testid="media-caption-input-container"]     # contenteditable
type   <caption>
verify [aria-label^="Send "] has aria-disabled="false"
click  [aria-label^="Send "]                             # NOT executed during recon
```

## Not established

- **Post-publish confirmation.** Nothing was sent, so what `[data-testid="status-header"]` looks
  like after publishing is unknown. This is the one thing a real post has to settle — the same
  gap LinkedIn had before its first live run.
- **Text-only status.** The "Text" menu option exists but was never opened, so its editor,
  background/colour pickers and its own send control are all unmapped. Text-only status is
  therefore unsupported until it gets its own recon.
- **Multi-image status.** The input is `multiple`, but only a single image was staged.
- **Audience/privacy.** No control exists in the composer; visibility is governed by account
  Settings, which were deliberately not opened. Out of scope by decision — treated as a normal
  status post.
