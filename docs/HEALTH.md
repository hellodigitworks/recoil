# Recoil health

Status: GREEN, in sync, clean, gate green. Nothing landed but Yard's own health record.
Checked: 2026-09-22 00:22 IST, Yard. Branches, the live pass, shots at both widths opened by eye, gates, chats and the Open checks.

## Live
| Address | Result | Note |
|---|---|---|
| https://recoil-app.netlify.app/ | 200, 28 KB | The live pass flagged it RED on a 106-second connection timeout. Re-checked by hand: 200 `text/html`, 28,095 bytes, 1.7s. Network, not the site |

Screenshots looked at, both widths. The page draws with "Recoil.", "Every night you have ever slept, finally worth reading." and the Connect Whoop button. 0 console errors, 0 failed requests.

## Branches
No branches besides main. Working tree clean. No stale `.lock` file.

## Deploy state
**In sync.** Last published to Netlify 10 Aug 2026. 8 ahead of origin, all Yard's own health records, never pushed. Whether a push puts it live is still unrecorded: treat a push as one.

## Open issues
None open. The decision from Aug 2026 stands: open the repo, no more hours.

## Reviewed changes
`194da86`, Yard's health record from last night. Nothing else.

## Gate
`npm test`: **128 pass, 0 fail**, 77 ms.

## Showcases waiting
None.

## Fixed by Yard
Nothing needed.
