# Recoil health

Status: GREEN. Gate passes 128 of 128. The page draws at both widths. In sync, last Netlify deploy 10 Aug.
Checked: 2026-09-21 00:22 IST, Yard. Ran on time and inside the budget: branches, live pass, shots at both widths opened by eye, chats and Open checks.

## Live
| Address | Result | Note |
|---|---|---|
| https://recoil-app.netlify.app/ | 200, GREEN | the page renders the Recoil logo, "Every night you have ever slept, finally worth reading." and a "Connect Whoop" button. 0 console errors, 0 failed requests, desktop and phone. Note: this headline and page copy differ from the title recorded at the 2026-09-03 baseline ("Recoil — how you actually recover"), so the live page has changed since that baseline even though no local commit has |

## Branches
None besides main. The working tree is clean.

## Deploy state
- In sync. The folder sits seven commits ahead of origin, every one a Yard health record, never pushed by design. Whether a push deploys this site is still not recorded, so a push is treated as a deploy until it is checked in the Netlify dashboard.
- Checked for a stale git lock first, as the registry asks, because one once made this repo look empty for two weeks. There is no `.lock` file in its git directory and the history reads normally.

## Open issues
| # | Sev | What | Where | Since | Proposed fix | Decision |
|---|---|---|---|---|---|---|

## Reviewed changes
- 2026-09-21: no commits since the last run. The gate `npm test` passes: 128 tests, 128 pass, 0 fail, 78 ms. No `.git/*.lock` in the repo, which is the trap that once made this repo look empty for two weeks. The first two shots runs captured the Chrome network error page for the desktop view, so the address was shot a third time once the network settled: 200, and the desktop shot came back at exactly the same byte size as last night's, 21,595 bytes, so nothing changed on the page. Both widths draw the Recoil landing with the Connect Whoop button.
- 2026-09-13: no commits since the last run. Load time over 3 seconds on two runs.
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
