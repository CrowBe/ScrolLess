# Vercel integration removal — issue #89

Recorded 2026-09-24. The supported direction is the [personal-host deployment](DEPLOYMENT.md), with implementation tracked in #84.

## Configuration and external settings

- Removed the repository root `vercel.json` SPA rewrite configuration. No Vercel dependencies or deployment workflows were present. Historical Vercel references remain in explicitly labeled `docs/archive/` snapshots.
- Disconnected `CrowBe/ScrolLess` from the Vercel project `compassionate-pasteur` in team `crowbes-projects`. The Git settings page confirmed “This Project is not connected to a Git repository.”
- Vercel reported no project deploy hooks before disconnection. GitHub reported no repository webhooks, Actions secrets or Actions variables; its Preview and Production environments also had no secrets or variables. No credential or hook deletion was necessary.
- GitHub ruleset `14707652` (“Main protection”) has no required status checks. Classic protection for `main` is absent. No Vercel merge requirement needed removal; existing PR and branch protections were preserved.
- The account-wide Vercel/GitHub integration and unrelated projects were preserved. Historical GitHub deployment environments and records were retained.

## Existing deployments and domains: retained, not retired

The project's Domains page lists only `compassionate-pasteur.vercel.app`, assigned to Production. No custom domain was listed. Disconnection does not disable this domain or delete deployments.

The [Vercel deployment inventory](https://vercel.com/crowbes-projects/compassionate-pasteur/deployments) still contains production and preview history, including:

| Deployment | Source | Disposition |
|---|---|---|
| `CEnPNYEqFmD1MgTeVsYLMNm1x5Vp` / `compassionate-pasteur-dobulyf73-crowbes-projects.vercel.app` | `9db7f61`, main, PR #88 merge | Ready; retained production deployment |
| `BBs74wzhUhQTDEoydgW4rruAezFH` / `compassionate-pasteur-9zd3t5ah3-crowbes-projects.vercel.app` | `70a4048`, PR #88 | Ready; retained preview |
| Older production and preview deployments | Earlier commits and PRs | Retained; no deletions performed |

The PR #88 branch preview alias `compassionate-pasteur-git-codex-issue-8-9cfee6-crowbes-projects.vercel.app` was also present. This is not an exhaustive list of historical deployment URLs; the project inventory is the source for that history. Vercel indicates deployment retention is enabled, so older entries may expire independently.

Remaining retirement action is separate: preserve any browser-origin content and keys needed for migration, then explicitly decide whether to pause or delete the project, deployments and domain. Existing project configuration is retained with those deployments. Do not remove shared account integrations or unrelated resources as part of that cleanup.

## Verification

- `npm ci` followed by `npm run validate:boot` passed on Node 24.14.0: production client/service-worker build, loopback server boot, `/health` and reader app shell. This verifies the existing serving path; the new personal-host runtime remains work for #82–#84.
- Post-disconnection push/PR verification is recorded in the implementation PR after GitHub activity is observed.
