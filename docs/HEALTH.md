# Recoil health

Status: GREEN. Nothing open. Tier 2, decision from August 2026 still stands: open the repo, no more hours. Live answers 200 at 1.4s with 0 console errors.
Checked: 2026-09-12 00:04 IST, Yard

## Live
| Address | Result | Note |
|---|---|---|
| https://recoil-app.netlify.app/ | 200, GREEN | the page renders the Recoil logo, "Every night you have ever slept, finally worth reading." and a "Connect Whoop" button. 0 console errors, 0 failed requests, desktop and phone. Note: this headline and page copy differ from the title recorded at the 2026-09-03 baseline ("Recoil — how you actually recover"), so the live page has changed since that baseline even though no local commit has |

## Branches
None besides main. The working tree is clean.

## Deploy state
- Nothing changed. Last commit 2026-09-03, still the health record baseline. Netlify site `recoil-app`, last deploy 10 August 2026. Whether a push deploys it is still unrecorded and should still be treated as a deploy until somebody checks the Netlify dashboard.
- Checked for a stale git lock first, as the registry asks, because one once made this repo look empty for two weeks. There is no `.lock` file in its git directory and the history reads normally.
- Gate `npm test` was not run, because nothing in the repo changed since the last run.

## Open issues
| # | Sev | What | Where | Since | Proposed fix | Decision |
|---|---|---|---|---|---|---|

## Reviewed changes
- 2026-09-11: no new commits. Gate not run, since nothing changed. Live page checked and differs in copy from the 2026-09-03 baseline title (see Live above), which is a live-side change with no matching local commit, worth a look next time this repo gets hours
- 2026-08-25: 84c0368 Settings says which build is running, and a test keeps it honest. ok
- 2026-08-10: 764836b Hand the day over on the clipboard, not through Safari. ok, fixes a real bug: the daily Shortcut couldn't reach the installed app's storage, and two click handlers threw on a stale event reference
- 2026-08-10: 355d4a9 Shortcut instructions: a prompt to build it, and the home-screen caveat. ok, docs only
- 2026-08-10: e59c9ea Give the Health data a copy, an age, and a way to refresh it. ok
- 2026-08-10: 8813b41 Bank the Shortcut's day before the Whoop session can turn us around. ok, fixes a real bug: an expired Whoop session dropped that day's Apple Health numbers silently
- 2026-08-10: 5c0a1b0 Read Apple Health, and set the type in Delight. ok

## Showcases waiting
| Branch | Preview | Shots | What to test | Asked |
|---|---|---|---|---|

## Fixed by Yard
Nothing tonight.
