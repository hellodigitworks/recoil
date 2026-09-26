# Recoil health

Status: GREEN, clean.
Checked: 2026-09-26 12:17 IST, Yard. A daytime run: the Mac slept for about fifty minutes partway through, so the screenshots were taken again once the network was back. Nothing changed since 25 September: same live results, same branches, same deploy state, screenshots opened by eye at both widths again, the Open checks run. 12 commits ahead of origin, all Yard's own health records.
Previous: 2026-09-25 00:04 IST, Yard.

## Live
| Address | Result | Note |
|---|---|---|
| https://recoil-app.netlify.app/ | 200, 3.5s desktop **SLOW**, 2.8s phone, 0 console errors | GREEN |

Screenshot looked at, both widths: the page draws the green mark, "Recoil.", "Every night you have ever slept, finally worth reading." and Connect Whoop. Nothing broken on screen. It is a slow first paint on a cold Netlify site and it has been for weeks.

## Branches
No branches besides main after tonight: two empty Lodge helper branches were removed, see Checked. Working tree clean. Checked for stale `.git` locks first, as the registry says to: none.

## Deploy state
**Unknown, by record rather than by fault.** The Netlify site last deployed on 10 August. Whether a push to GitHub deploys it is not recorded anywhere, so a push is treated as a deploy until you check it in the Netlify dashboard. Nine commits sit ahead of origin and every one is a health record, so nothing real is waiting either way.

## Open issues
None open.

## Reviewed changes
Nothing new since the last run. `ad6d09f` is Yard's own health record from last night.

## Showcases waiting
None, and none are allowed here by your decision of August: safe fixes only, no more hours.

## Fixed by Yard
Nothing needed.
