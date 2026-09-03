# Recoil health

Status: GREEN. Nothing open.
Checked: 2026-09-03 17:06 IST, baseline

## Live
| Address | Result | Note |
|---|---|---|
| https://recoil-app.netlify.app/ | 200, 28095 bytes, text/html | title "Recoil — how you actually recover"; found via .netlify/state.json's site id, matched against `netlify sites:list` |

## Deploy state
- Local ahead by 1 commit since 2026-08-10. Recorded, not a bug: Swayam decides when to deploy.
- Last commit: 2026-08-25, 84c0368 Settings says which build is running, and a test keeps it honest
- Last deploy: 2026-08-10 15:01 IST, Netlify production deploy 6a799a59d3419432defa838c (manual/CLI, not git-connected: commit_ref is null on every deploy in the account history)
- Uncommitted: none
- Deploys by: `netlify deploy`, manual, from this folder

## Open issues
| # | Sev | What | Where | Since | Proposed fix | Decision |
|---|---|---|---|---|---|---|

## Reviewed changes
- 2026-08-25: 84c0368 Settings says which build is running, and a test keeps it honest. ok
- 2026-08-10: 764836b Hand the day over on the clipboard, not through Safari. ok, fixes a real bug: the daily Shortcut couldn't reach the installed app's storage, and two click handlers threw on a stale event reference
- 2026-08-10: 355d4a9 Shortcut instructions: a prompt to build it, and the home-screen caveat. ok, docs only
- 2026-08-10: e59c9ea Give the Health data a copy, an age, and a way to refresh it. ok
- 2026-08-10: 8813b41 Bank the Shortcut's day before the Whoop session can turn us around. ok, fixes a real bug: an expired Whoop session dropped that day's Apple Health numbers silently
- 2026-08-10: 5c0a1b0 Read Apple Health, and set the type in Delight. ok

## Showcases waiting
| Branch | Preview | Shots | What to test | Asked |
|---|---|---|---|---|

## Fixed by Code Review
| Date | What | Commit | Pushed | Deployed | Verified live |
|---|---|---|---|---|---|
