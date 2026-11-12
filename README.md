# Scoutline

Scoutline is a quick VEX V5 team lookup tool. Search a team number, compare multiple teams side by side using the included skills snapshot, and optionally connect your RobotEvents API key to see live event details.

The webapp is available at:

`https://alijahbarta-jpg.github.io/scouting-for-vex-v5/`

## Use the app

1. Open the app in a browser.
2. Search by team number or team name, then choose a suggestion or enter a team number directly.
3. If the team appears in the bundled standings snapshot, you can review rank, skills scores, and location information right away.
4. Use the **Team search** and **Compare teams** workspace tabs to switch between lookup/results and side-by-side comparisons. After a team is found, choose **Compare this team** to add it to the comparison and open that workspace. Compare up to four teams using snapshot standings, or connect RobotEvents and explicitly load live data for skills, event placements, match records, and awards. Calendar-year filters are based on event dates; the snapshot only provides the latest recorded score year, not a full historical archive.
5. If you want more detail, paste your RobotEvents API key and the app will fetch live information from RobotEvents, including awards, events, match records, and skills results.
6. Reloading the page clears the in-memory API key, so the app does not keep your key after you leave.

Comparison selections, workspace, data source, comparison type, calendar year, and selected event are reflected in the page URL and can be shared. Shared links include comparison settings, not live API results, scouting notes, or an API key; each viewer must connect their own key and load live data. Use **Export CSV** to download the current comparison. Snapshot and live results are labeled separately with their data freshness and coverage; event comparisons require a RobotEvents API key and loaded live team data.

The sidebar shows the skills snapshot’s team count and latest score date, with shortcuts to compare or download the CSV. The workspace navigation switches between separate search and comparison areas.

Team notes and scouting tags are saved in this browser's local storage and are not sent to the app server or included in shared links. Live team results are cached in page memory, loaded one team at a time, and can be refreshed or retried. Temporary connection and rate-limit failures are retried automatically.

## Run locally

```sh
npm ci
npm run dev
```

Create a production build with:

```sh
npm run build
```

## Data sources

### Skills snapshot

The app loads `public/skills-standings.csv`, which is a bundled snapshot of VEX team standings and skills data included with the project. The example lookup `8737M` is included so you can test the app immediately.

This snapshot is intentionally static. To refresh it, replace the CSV file with a newer export and redeploy the site. This file includes ranking and skills information, but it does not include team awards, competition placements, match records, or event participation.

### Live RobotEvents lookup

If you connect a valid RobotEvents API key, the app validates it against the public V5RC program endpoint and then queries the official `https://events.vex.com/api/v2` API for a team profile, events, awards, skills runs, match scores, and rankings.

Your key stays in page memory only and is sent directly from the browser to RobotEvents. It is not saved to browser storage or sent to this site's server. Closing or reloading the page clears it.

This requires a working internet connection and a valid RobotEvents account. If no key is connected, the local CSV snapshot remains available. Do not paste API keys into a shared or untrusted browser session, because scripts running in that page can read them while they are active.
