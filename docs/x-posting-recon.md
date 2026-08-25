# X (Twitter) posting recon — ego-browser run

**Date:** 2026-08-08
**Method:** ego-browser task space `x post recon techdad` (id 1), against the live logged-in session.
**Scope:** account switching, active-account verification, compose, publish, post-URL capture.
**Result:** full loop verified end to end with a real post —
[x.com/TheAvgTechDad/status/2086129413763006973](https://x.com/TheAvgTechDad/status/2086129413763006973)

## Verified selectors

Every hook below is a `data-testid`, i.e. an ordinary CSS selector. All of these are
driver-agnostic — they work unchanged in ego-browser, Playwright, or Puppeteer.

| Purpose | Selector | Verified |
|---|---|---|
| Active account (source of truth) | `[data-testid="SideNav_AccountSwitcher_Button"]` | yes — `innerText` → `TheAverageTechDad \| @TheAvgTechDad` |
| Open the switcher | click the same element | yes |
| Inactive account rows | `button[data-testid="UserCell"]` **scoped to the switcher popup** | yes — yields `@super__mx`, `@usepowershare`, `@kasa_africa` |
| Switcher popup container | no stable hook; reach it by walking up from `[data-testid="AccountSwitcher_AddAccount_Button"]` until the ancestor contains `UserCell` children | yes |
| Composer textarea | `[data-testid="tweetTextarea_0"]` | present |
| Post button (inline composer) | `[data-testid="tweetButtonInline"]` | present |
| Post button (modal composer) | `[data-testid="tweetButton"]` | absent on `/home`, appears in modal |
| Media upload input | `input[data-testid="fileInput"]` | present (upload not exercised) |
| New-post button (opens modal) | `[data-testid="SideNav_NewTweet_Button"]` | present |
| Send confirmation | `[data-testid="toast"]` → `Your post was sent. \| View` | yes |
| **Published post URL** | `[data-testid="toast"] a` → `href` | yes — absolute permalink |
| Post text on permalink page | `article[data-testid="tweet"] [data-testid="tweetText"]` | yes |

Accounts currently in the session: `@TheAvgTechDad`, `@super__mx`, `@usepowershare`, `@kasa_africa`
— i.e. three brands plus personal, all one click apart.

## Three traps

**1. `UserCell` is not unique to the switcher.** A document-wide
`button[data-testid="UserCell"]` query also matched `@missowaa`, a "who to follow"
suggestion in the right rail — which carries a **Follow button**. An unscoped
`UserCell` + handle filter can therefore click a stranger's Follow button while
believing it switched accounts. **Always scope to the switcher popup.**

**2. The active account is absent from the `UserCell` list.** Only *inactive*
accounts render as `UserCell`. The active row is drawn as unstyled nested `div`s
with no `data-testid`, no `role`, and no `aria-checked` anywhere in its ancestor
chain — the green check is presentational only. So the switcher popup **cannot**
be used to read who you currently are.

**3. Switching is not instantaneous.** The account swap took more than one second
and under ten. A fixed `wait()` is a race; poll the sidebar handle until it
matches, with a timeout.

## The guard

Trap 2 dictates where the check goes. Read the active handle from the **sidebar
button**, which is always present without opening any menu:

```js
// driver-agnostic; the selector is the same in Playwright
const active = activeHandleFrom('[data-testid="SideNav_AccountSwitcher_Button"]')
if (active !== '@' + account.handle) throw new Error(`wrong account: ${active}`)
// ...only now compose and post
```

Run it **immediately before composing**, on every post, unconditionally. With one
session holding four accounts, a silently-failed switch publishes one brand's copy
under another brand's name, publicly, in the wrong voice. This is the single worst
failure mode in the system and the check costs one selector read.

## Verdict: what is salvageable for Playwright

**The selectors are fully salvageable — 100% of them.** They are plain
`data-testid` CSS selectors with no ego-browser-specific syntax. An earlier concern
that `@N` refs wouldn't port was too narrow: refs are one addressing mode, and
nothing here needed them. This recon produced a selector recipe usable by either
driver.

**But the selectors were never the problem.** Nothing found here is brittle
CSS-hash guesswork; X's testids are stable and well-named. So if Playwright was
underperforming on this task, the cause lies in the *session* layer, not the
locator layer:

- ego-browser inherits the **already-logged-in, multi-account** browser state.
- The PRD's Playwright design uses a **cold, per-account `launchPersistentContext`
  user-data-dir** (§193, §290, §301) — a fresh profile whose only history is
  automation.

Which means: porting these selectors into Playwright + `launchPersistentContext`
reproduces the original problem, because it changes the part that worked while
keeping the part that didn't.

**Consequence for the decision.** The choice is no longer "ego-browser vs
Playwright" — the selector work is shared either way and is now written down. The
real question is narrower: **which session model do we post from?** Answer that,
and the driver follows from it rather than the other way round.

## Verified publish sequence

```
guard: read [data-testid="SideNav_AccountSwitcher_Button"] -> must equal @handle, else abort
click  [data-testid="tweetTextarea_0"]          # focus
type   <body>                                    # real keystrokes, NOT value assignment
read   [data-testid="tweetTextarea_0"].innerText # confirm text landed here and nowhere else
guard  again                                     # immediately before the irreversible click
click  [data-testid="tweetButtonInline"]
wait   for [data-testid="toast"]
read   [data-testid="toast"] a -> href           # this IS posts.post_url
```

Two notes from the run:

- The composer is a **rich-text editor**. Real keyboard input works; assigning
  `.value` will not. Read the text back before publishing — this also catches the
  case where keystrokes were captured by the search box instead (checked, clean).
- **`posts.post_url` comes free from the toast.** No profile-scrape needed. Read it
  before the toast auto-dismisses; if missed, fall back to the account's latest
  post on `/{handle}`.

## Media upload (verified 2026-08-08)

`uploadFile('input[data-testid="fileInput"]', absolutePath)` works on the hidden input. After it,
X renders `[data-testid="attachments"]` holding one `img[src^="blob:"]` per file, and shows
`[data-testid="progressBar-bar"]` while the upload is still in flight.

**Both conditions are needed.** The `img` appears *before* the upload completes, so counting
images alone will let you click Post mid-upload.

## ego-browser behaviours that cost real debugging time

None of these are X's doing; they are how the CLI behaves, and each one failed silently.

1. **`cliLog` writes to STDERR, not stdout.** A runner that reads only stdout gets an empty array
   from every single call, and the failure looks like "the browser never became ready".
2. **`click()` takes one selector, not a list.** A comma-separated CSS list matches nothing and
   the click silently does not happen — visible only as an action that never took effect.
3. **A click from a script that begins with `openOrReuseTab` does not register.** The identical
   click from a script without it works every time. Scripts that act on already-staged page state
   must not re-open the tab first.
4. **State persists across scripts, and `typeText` inserts at the cursor.** `openOrReuseTab` does
   *not* clear the composer, so a failed run leaves its text and media staged and the next run
   splices its draft into the middle of the old one. `gotoAndWait` is what actually clears it.
5. **The composer needs a settle delay before it accepts the Post click.** Clicking ~1s after the
   upload script exits reliably does nothing; the same click succeeds after a few seconds.

## Not yet tested

- Dead-session / re-auth detection and `handOffTaskSpace`.
- Multi-line posts. Only single-line bodies have gone out live.
- More than one image on a post (the 4-image path is coded but unexercised).
- Anything other than X. LinkedIn, Instagram, TikTok all unexamined.
