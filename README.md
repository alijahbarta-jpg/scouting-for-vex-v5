# Scoutline

A React + TypeScript frontend for scouting VEX V5 teams, with a searchable snapshot of team identities and robot skills standings.

## Run locally

```sh
npm install
npm run dev
```

Create a production build with `npm run build`.

## Publish on GitHub Pages

The included GitHub Actions workflow builds and deploys the site when changes are pushed to `main` (or when manually started from the Actions tab). In the repository's **Settings → Pages**, set the build and deployment source to **GitHub Actions**. After the first successful deployment, the site will be available at:

`https://alijahbarta-jpg.github.io/scouting-for-vex-v5/`

The Vite configuration applies the repository subpath for GitHub Actions builds and keeps the root path for local development.

## Skills standings data

The dashboard loads `public/skills-standings.csv`, the standings export supplied with this project. Search supports the teams in that snapshot; the example lookup is `8737M`. The displayed latest-score date is taken from the timestamps in the CSV.

This is a static snapshot, not an automatically refreshed live feed. To update the standings, replace the CSV with a current export and redeploy the site. The file contains rankings and robot skills scores, but not team awards, tournament placements, event participation, or match records, so those results are not fabricated or shown.

## Live RobotEvents lookup

Users can optionally paste their own RobotEvents API key into the dashboard. The app validates it against the public V5RC program endpoint, then queries the official `https://events.vex.com/api/v2` API for a team's profile, events, awards, skills runs, match scores, and event rankings. The API key remains in page memory only and is sent directly from the browser to RobotEvents; it is not written to browser storage or sent to this site's server. Reloading or closing the page clears it.

This requires a valid API key from the user's RobotEvents account and an internet connection. If the key is not connected, the CSV skills snapshot remains available. Do not paste API keys into a shared or untrusted deployment; client-side keys are visible to scripts running in that browser session.
