# Scoutline

Scoutline is a quick VEX V5 team lookup tool. Search a team number, compare it against the included skills snapshot, and optionally connect your RobotEvents API key to see live event details.

## Use the app

1. Open the app in a browser.
2. Enter a team number such as `8737M`.
3. If the team appears in the bundled standings snapshot, you can review rank, skills scores, and location information right away.
4. If you want more detail, paste your RobotEvents API key and the app will fetch live information from RobotEvents, including awards, events, match records, and skills results.
5. Reloading the page clears the in-memory API key, so the app does not keep your key after you leave.

## Run locally

```sh
npm install
npm run dev
```

Create a production build with:

```sh
npm run build
```

## GitHub Pages deployment

This repository includes a GitHub Actions workflow that builds and deploys the site when changes are pushed to `main` or when the workflow is started manually from the Actions tab.

To publish the site:

1. Open the repository in GitHub.
2. Go to **Settings → Pages**.
3. Set the build and deployment source to **GitHub Actions**.
4. After the first successful deployment, the site is available at:

`https://alijahbarta-jpg.github.io/scouting-for-vex-v5/`

The Vite config keeps local development on the root URL and uses the repository subpath when deployed to GitHub Pages.

## Data sources

### Skills snapshot

The app loads `public/skills-standings.csv`, which is a bundled snapshot of VEX team standings and skills data included with the project. The example lookup `8737M` is included so you can test the app immediately.

This snapshot is intentionally static. To refresh it, replace the CSV file with a newer export and redeploy the site. This file includes ranking and skills information, but it does not include team awards, competition placements, match records, or event participation.

### Live RobotEvents lookup

If you connect a valid RobotEvents API key, the app validates it against the public V5RC program endpoint and then queries the official `https://events.vex.com/api/v2` API for a team profile, events, awards, skills runs, match scores, and rankings.

Your key stays in page memory only and is sent directly from the browser to RobotEvents. It is not saved to browser storage or sent to this site's server. Closing or reloading the page clears it.

This requires a working internet connection and a valid RobotEvents account. If no key is connected, the local CSV snapshot remains available. Do not paste API keys into a shared or untrusted browser session, because scripts running in that page can read them while they are active.
