import { useEffect, useState, type FormEvent } from "react";
import {
  ArrowRight,
  Award as AwardIcon,
  ChevronDown,
  CircleHelp,
  Compass,
  ExternalLink,
  KeyRound,
  MapPin,
  Search,
  ShieldCheck,
  Users,
  X,
} from "lucide-react";
import { parseSkillsStandings, type SkillsStanding } from "./data";
import {
  lookupRobotEventsTeam,
  RobotEventsError,
  validateRobotEventsKey,
  type LiveTeamDetails,
} from "./robotEvents";

const exampleTeamNumber = "8737M";

function SkillBar({
  label,
  value,
  max,
  color,
}: {
  label: string;
  value: number;
  max: number;
  color: string;
}) {
  return (
    <div className="skill-row">
      <div className="skill-label">
        <span>{label}</span>
        <span className="skill-score">{value}<span className="score-max"> / {max} in snapshot</span></span>
      </div>
      <div className="skill-track">
        <div className={`skill-fill ${color}`} style={{ width: `${max ? (value / max) * 100 : 0}%` }} />
      </div>
    </div>
  );
}

function formatSnapshotDate(timestamp: string): string {
  const date = new Date(`${timestamp.replace(" ", "T")}Z`);
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeZone: "UTC" }).format(date);
}

function App() {
  const [query, setQuery] = useState(exampleTeamNumber);
  const [selectedNumber, setSelectedNumber] = useState(exampleTeamNumber);
  const [standings, setStandings] = useState<SkillsStanding[]>([]);
  const [snapshotDate, setSnapshotDate] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [notice, setNotice] = useState("");
  const [apiKeyDraft, setApiKeyDraft] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [apiKeyStatus, setApiKeyStatus] = useState("");
  const [apiKeyError, setApiKeyError] = useState("");
  const [liveTeam, setLiveTeam] = useState<LiveTeamDetails | null>(null);
  const [apiLoading, setApiLoading] = useState(false);

  useEffect(() => {
    const controller = new AbortController();

    async function loadStandings() {
      try {
        const response = await fetch(`${import.meta.env.BASE_URL}skills-standings.csv`, {
          signal: controller.signal,
        });
        if (!response.ok) {
          throw new Error(`The standings file could not be loaded (HTTP ${response.status}).`);
        }
        const data = parseSkillsStandings(await response.text());
        setStandings(data.rows);
        setSnapshotDate(data.latestScoreAt);
      } catch (error) {
        if (controller.signal.aborted) return;
        setLoadError(error instanceof Error ? error.message : "The standings file could not be loaded.");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }

    void loadStandings();
    return () => controller.abort();
  }, []);

  const team = standings.find((standing) => standing.teamNumber === selectedNumber) ?? null;
  const highestProgramming = Math.max(0, ...standings.map((standing) => standing.highestProgramming));
  const highestDriver = Math.max(0, ...standings.map((standing) => standing.highestDriver));

  async function searchTeamNumber(teamNumber: string, token = apiKey) {
    if (!/^\d{1,6}[A-Z]{0,2}$/.test(teamNumber)) {
      setNotice("Enter a VEX team number such as 8737M.");
      return;
    }

    setSelectedNumber(teamNumber);
    setQuery(teamNumber);
    setNotice("");
    setLiveTeam(null);
    if (token) {
      setApiLoading(true);
      try {
        const result = await lookupRobotEventsTeam(token, teamNumber);
        setLiveTeam(result);
        if (!result) setNotice(`${teamNumber} was not found in the RobotEvents V5RC records.`);
      } catch (error) {
        setApiKeyError(error instanceof Error ? error.message : "Could not load team details from RobotEvents.");
      } finally {
        setApiLoading(false);
      }
      return;
    }

    if (!loading && !loadError && !standings.some((standing) => standing.teamNumber === teamNumber)) {
      setNotice(`${teamNumber} is not in this skills standings snapshot.`);
    }
  }

  function searchTeam(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setApiKeyError("");
    void searchTeamNumber(query.trim().toUpperCase());
  }

  async function connectApiKey(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const token = apiKeyDraft.trim();
    if (!token) {
      setApiKeyError("Paste your RobotEvents API key first.");
      return;
    }
    setApiKeyError("");
    setApiKeyStatus("Checking key…");
    try {
      await validateRobotEventsKey(token);
      setApiKey(token);
      setApiKeyStatus("Connected to RobotEvents");
      await searchTeamNumber(query.trim().toUpperCase(), token);
    } catch (error) {
      setApiKeyStatus("");
      setApiKeyError(error instanceof RobotEventsError ? error.message : "Could not verify the RobotEvents API key.");
    }
  }

  function disconnectApiKey() {
    setApiKey("");
    setApiKeyDraft("");
    setApiKeyStatus("");
    setApiKeyError("");
    setLiveTeam(null);
  }

  function handleSearchInput(value: string) {
    setQuery(value);
    setNotice("");
    setApiKeyError("");
  }

  function showExample() {
    if (apiKey) {
      setApiKeyError("");
      void searchTeamNumber(exampleTeamNumber, apiKey);
    } else {
      setQuery(exampleTeamNumber);
      setSelectedNumber(exampleTeamNumber);
      setLiveTeam(null);
      setNotice("");
    }
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="#" aria-label="Scoutline home" onClick={showExample}>
          <div className="brand-mark"><Compass size={21} strokeWidth={2.2} /></div>
          <span>scoutline<span className="brand-period">.</span></span>
        </a>
        <div className="sidebar-section-label">WORKSPACE</div>
        <button className="nav-item active" onClick={showExample}>
          <Search size={17} /> <span>Team search</span>
        </button>
        <div className="sidebar-section-label seasons-label">DATA</div>
        <div className="nav-item active-season season-summary"><span className="season-dot" /> <span>Skills standings</span></div>
        <div className="sidebar-bottom">
          <div className="sidebar-callout">
            <div className="callout-icon"><CircleHelp size={17} /></div>
            <p>Need full event results?</p>
            <span>Open the team page for more details.</span>
            {(liveTeam || team) && <a href={`https://events.vex.com/teams/V5RC/${encodeURIComponent(liveTeam?.number ?? team?.teamNumber ?? "")}`} target="_blank" rel="noreferrer">VEX team page <ExternalLink size={13} /></a>}
          </div>
          <div className="profile">
            <div className="avatar">SC</div>
            <div className="profile-copy"><strong>Scout crew</strong><span>Team workspace</span></div>
            <button className="icon-button profile-menu" aria-label="Workspace options"><ChevronDown size={16} /></button>
          </div>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div className="breadcrumbs"><span>Workspace</span><span className="crumb-slash">/</span><strong>Team search</strong></div>
          <div className="topbar-right">
            <span className="season-pill"><span /> {apiKey ? "RobotEvents API" : "Skills CSV snapshot"}</span>
            <button className="icon-button help-button" aria-label="Help"><CircleHelp size={18} /></button>
          </div>
        </header>

        <div className="page-wrap">
          <section className="page-heading">
            <div>
              <div className="eyebrow"><span className="eyebrow-line" /> VEX V5 COMPETITION INTELLIGENCE</div>
              <h1>Look up a team in <span>seconds.</span></h1>
              <p className="page-intro">Search the built-in skills snapshot or connect RobotEvents for the full picture on a team.</p>
            </div>
          </section>

          <form className="search-panel" onSubmit={searchTeam}>
            <div className="search-field-wrap">
              <Search size={19} className="search-icon" />
              <input
                aria-label="VEX team number"
                placeholder="Enter a VEX team number (e.g. 8737M)"
                value={query}
                onChange={(event) => handleSearchInput(event.target.value)}
              />
              {query && <button className="clear-search" type="button" aria-label="Clear search" onClick={() => handleSearchInput("")}><X size={15} /></button>}
              <span className="input-divider" />
              <span className="search-hint">TEAM NUMBER</span>
            </div>
            <button className="search-button" type="submit" disabled={(loading || Boolean(loadError)) && !apiKey || apiLoading}>
              {apiLoading ? "Fetching" : loading ? "Loading" : "Look it up"} <ArrowRight size={16} />
            </button>
          </form>

          <section className="api-key-panel">
            <div className="api-key-heading">
              <div className="api-key-icon"><KeyRound size={16} /></div>
              <div>
                <strong>Need live team details?</strong>
                <span>Paste your RobotEvents API key to unlock awards, skills runs, match records, and event history.</span>
              </div>
              {apiKeyStatus && <span className="api-connected"><ShieldCheck size={14} /> {apiKeyStatus}</span>}
            </div>
            {apiKey ? (
              <div className="api-key-connected-row">
                <span>Your key is stored only in this page's memory and sent directly to RobotEvents for live lookups.</span>
                <button className="text-link" type="button" onClick={disconnectApiKey}>Disconnect key</button>
              </div>
            ) : (
              <form className="api-key-form" onSubmit={connectApiKey}>
                <input
                  aria-label="RobotEvents API key"
                  autoComplete="off"
                  type="password"
                  placeholder="Paste your RobotEvents API key"
                  value={apiKeyDraft}
                  onChange={(event) => { setApiKeyDraft(event.target.value); setApiKeyError(""); }}
                />
                <button className="connect-button" type="submit" disabled={apiKeyStatus === "Checking key…"}>
                  {apiKeyStatus === "Checking key…" ? "Checking…" : "Connect key"}
                </button>
              </form>
            )}
            <p className="api-key-note">
              This app keeps the key in memory only while the page is open, then sends it directly to RobotEvents. It is not saved in browser storage or sent to this site's server. Anyone with access to this page's scripts can inspect it while it is active.{" "}
              <a href="https://events.vex.com/api/v2" target="_blank" rel="noreferrer">Get a key from RobotEvents <ExternalLink size={11} /></a>
            </p>
            {apiKeyError && <p className="api-key-error" role="alert">{apiKeyError}</p>}
          </section>

          {(notice || loadError) && (
            <div className="notice" role="status">
              <span>{loadError || notice}</span>
              {!team && !loadError && <button type="button" onClick={showExample}>View example team <ArrowRight size={14} /></button>}
            </div>
          )}

          {apiLoading ? (
            <section className="empty-state" aria-live="polite">
              <div className="empty-icon"><Search size={23} /></div>
              <h2>Fetching team records</h2>
              <p>Loading events, awards, skills, match records, and rankings from RobotEvents.</p>
            </section>
          ) : liveTeam ? (
            <>
              <div className="snapshot-banner live-banner">
                <span className="snapshot-dot live-dot" />
                <span><strong>RobotEvents live lookup</strong> — details fetched using your API key.</span>
                <span className="snapshot-date">Retrieved just now</span>
              </div>

              <section className="team-card">
                <div className="team-identity">
                  <div className="team-avatar"><span>{liveTeam.number.slice(0, 2)}</span><small>{liveTeam.number.slice(2)}</small></div>
                  <div className="team-info">
                    <div className="team-number">TEAM {liveTeam.number}</div>
                    <h2>{liveTeam.name}</h2>
                    <div className="team-meta">
                      {liveTeam.organization && <span><Users size={14} /> {liveTeam.organization}</span>}
                      {liveTeam.location && <span><MapPin size={14} /> {liveTeam.location}</span>}
                      {liveTeam.grade && <span>{liveTeam.grade}</span>}
                    </div>
                  </div>
                </div>
                <div className="team-card-right">
                  <span className="division-label">VEX V5 ROBOTICS</span>
                  <span className="active-season-tag"><span /> Live API</span>
                </div>
              </section>

              <section className="stat-grid" aria-label="Live team summary">
                <article className="stat-card">
                  <div className="stat-top"><span>Events attended</span><span className="stat-icon mint-icon"><MapPin size={16} /></span></div>
                  <div className="stat-value">{liveTeam.events}</div>
                  <div className="stat-foot"><span className="stat-note">All events returned by API</span></div>
                </article>
                <article className="stat-card">
                  <div className="stat-top"><span>Match record</span><span className="stat-icon gold-icon"><AwardIcon size={16} /></span></div>
                  <div className="stat-value">{liveTeam.wins}–{liveTeam.losses}–{liveTeam.ties}</div>
                  <div className="stat-foot"><span className="stat-note">From scored matches</span></div>
                </article>
                <article className="stat-card skills-stat">
                  <div className="stat-top"><span>Best skills score</span><span className="stat-icon blue-icon"><AwardIcon size={16} /></span></div>
                  <div className="stat-value">{liveTeam.skills.combined}</div>
                  <div className="stat-foot"><span className="stat-note">Best programming + driver</span></div>
                </article>
              </section>

              <div className="content-grid">
                <section className="panel awards-panel">
                  <div className="panel-heading">
                    <div><span className="panel-kicker">RECOGNITION</span><h3>Team awards <span className="count-badge">{liveTeam.awards.length}</span></h3></div>
                  </div>
                  <div className="award-list">
                    {liveTeam.awards.slice(0, 5).map((award) => (
                      <article className="award-row" key={`${award.name}-${award.event}-${award.date}`}>
                        <div className="award-mark mint"><AwardIcon size={18} /></div>
                        <div className="award-copy"><strong>{award.name}</strong><span>{award.event}</span></div>
                        <time>{award.date}</time>
                      </article>
                    ))}
                    {liveTeam.awards.length === 0 && <p className="panel-empty">No awards were returned for this team.</p>}
                  </div>
                </section>

                <section className="panel skills-panel">
                  <div className="panel-heading">
                    <div><span className="panel-kicker">ROBOT SKILLS</span><h3>Best recorded scores</h3></div>
                  </div>
                  <div className="skills-total"><strong>{liveTeam.skills.combined}</strong><span>best programming + driver</span>
                    {liveTeam.skillsRank !== null && <span className="best-score">Best run rank #{liveTeam.skillsRank}</span>}
                  </div>
                  <div className="skills-bars">
                    <SkillBar label="Programming" value={liveTeam.skills.programming} max={liveTeam.skills.combined || 1} color="violet-fill" />
                    <SkillBar label="Driver" value={liveTeam.skills.driver} max={liveTeam.skills.combined || 1} color="green-fill" />
                  </div>
                  <div className="skills-footer"><span><span className="legend-dot violet-dot" /> Programming</span><span><span className="legend-dot green-dot" /> Driver skills</span></div>
                </section>
              </div>

              <section className="panel tournaments-panel" id="tournaments">
                <div className="panel-heading tournament-heading">
                  <div><span className="panel-kicker">COMPETITION HISTORY</span><h3>Events and placements <span className="count-badge">{liveTeam.tournaments.length}</span></h3></div>
                </div>
                <div className="table-scroll">
                  <table>
                    <thead><tr><th>EVENT</th><th>DATE</th><th>PLACEMENT</th><th>RECORD</th><th>HIGHLIGHT</th><th aria-label="Details" /></tr></thead>
                    <tbody>
                      {liveTeam.tournaments.slice(0, 10).map((event) => (
                        <tr key={event.id}>
                          <td><div className="event-name">{event.name}</div><div className="event-location"><MapPin size={12} /> {event.location}</div></td>
                          <td className="date-cell">{event.date}</td>
                          <td><span className="placement">{event.placement}</span></td>
                          <td><span className="record">{event.record}</span></td>
                          <td>{event.award ? <span className="highlight-tag">{event.award}</span> : <span className="no-highlight">—</span>}</td>
                          <td><a className="row-arrow" aria-label={`View ${event.name} on RobotEvents`} href={`https://events.vex.com/events/${event.id}`} target="_blank" rel="noreferrer"><ExternalLink size={14} /></a></td>
                        </tr>
                      ))}
                      {liveTeam.tournaments.length === 0 && <tr><td colSpan={6}>No event history was returned for this team.</td></tr>}
                    </tbody>
                  </table>
                </div>
                <div className="table-footer"><span>Showing {Math.min(liveTeam.tournaments.length, 10)} of {liveTeam.tournaments.length} events</span><span>Records are calculated from scored matches.</span></div>
              </section>

              <footer className="page-footer"><span>SCOUTLINE <span className="footer-dot">•</span> VEX V5 TEAM INTELLIGENCE</span><span>Live data provided by RobotEvents API.</span></footer>
            </>
          ) : loading ? (
            <section className="empty-state" aria-live="polite">
              <div className="empty-icon"><Search size={23} /></div>
              <h2>Loading skills standings</h2>
              <p>Reading the supplied team standings file.</p>
            </section>
          ) : apiKey ? (
            <section className="empty-state" role={apiKeyError ? "alert" : "status"}>
              <div className="empty-icon"><Search size={23} /></div>
              <h2>{apiKeyError ? "RobotEvents lookup failed" : "Team not found in RobotEvents"}</h2>
              <p>{apiKeyError || notice || `${selectedNumber} was not found. Enter another team number to search live records.`}</p>
            </section>
          ) : loadError ? (
            <section className="empty-state" role="alert">
              <div className="empty-icon"><Search size={23} /></div>
              <h2>Standings unavailable</h2>
              <p>Check that <code>skills-standings.csv</code> is present in the deployed site, then try again.</p>
            </section>
          ) : team ? (
            <>
              <div className="snapshot-banner">
                <span className="snapshot-dot" />
                <span><strong>Skills standings snapshot</strong> — imported from the CSV supplied for this app.</span>
                <span className="snapshot-date">Latest recorded score: {formatSnapshotDate(snapshotDate)}</span>
              </div>

              <section className="team-card">
                <div className="team-identity">
                  <div className="team-avatar"><span>{team.teamNumber.slice(0, 2)}</span><small>{team.teamNumber.slice(2)}</small></div>
                  <div className="team-info">
                    <div className="team-number">TEAM {team.teamNumber}</div>
                    <h2>{team.teamName}</h2>
                    <div className="team-meta">
                      {team.organization && <span><Users size={14} /> {team.organization}</span>}
                      {[team.region, team.country].filter(Boolean).length > 0 && <span><MapPin size={14} /> {[team.region, team.country].filter(Boolean).join(", ")}</span>}
                    </div>
                  </div>
                </div>
                <div className="team-card-right">
                  <span className="division-label">VEX V5 ROBOTICS</span>
                  <span className="active-season-tag"><span /> In supplied standings</span>
                </div>
              </section>

              <section className="stat-grid" aria-label="Team skills standings summary">
                <article className="stat-card">
                  <div className="stat-top"><span>Skills rank</span><span className="stat-icon mint-icon"><AwardIcon size={16} /></span></div>
                  <div className="stat-value">#{team.rank}</div>
                  <div className="stat-foot"><span className="stat-note">Rank in this CSV snapshot</span></div>
                </article>
                <article className="stat-card">
                  <div className="stat-top"><span>Combined skills score</span><span className="stat-icon gold-icon"><AwardIcon size={16} /></span></div>
                  <div className="stat-value">{team.score}<span className="stat-unit"> points</span></div>
                  <div className="stat-foot"><span className="stat-note">Autonomous + driver skills</span></div>
                </article>
                <article className="stat-card skills-stat">
                  <div className="stat-top"><span>Teams in snapshot</span><span className="stat-icon blue-icon"><Users size={16} /></span></div>
                  <div className="stat-value">{standings.length.toLocaleString()}</div>
                  <div className="stat-foot"><span className="stat-note">Rows in supplied CSV</span></div>
                </article>
              </section>

              <div className="content-grid">
                <section className="panel skills-panel">
                  <div className="panel-heading">
                    <div><span className="panel-kicker">ROBOT SKILLS</span><h3>Best skills scores</h3></div>
                  </div>
                  <div className="skills-total"><strong>{team.score}</strong><span>combined score</span></div>
                  <div className="skills-bars">
                    <SkillBar label="Best autonomous coding" value={team.highestProgramming} max={highestProgramming} color="violet-fill" />
                    <SkillBar label="Best driver skills" value={team.highestDriver} max={highestDriver} color="green-fill" />
                  </div>
                  <div className="skills-footer"><span><span className="legend-dot violet-dot" /> Autonomous coding</span><span><span className="legend-dot green-dot" /> Driver skills</span></div>
                </section>

                <section className="panel data-limits-panel">
                  <div className="panel-heading">
                    <div><span className="panel-kicker">DATA INCLUDED</span><h3>Snapshot view</h3></div>
                  </div>
                  <p>This CSV includes team names, locations, ranks, and skills scores. It does not include awards, event placements, participation history, or match records. Connect RobotEvents for the full competition picture.</p>
                  <a className="text-link" href={`https://events.vex.com/teams/V5RC/${encodeURIComponent(team.teamNumber)}`} target="_blank" rel="noreferrer">
                    Open VEX team page <ExternalLink size={14} />
                  </a>
                </section>
              </div>

              <section className="panel tournaments-panel source-panel">
                <div className="panel-heading">
                  <div><span className="panel-kicker">SOURCE</span><h3>Supplied skills standings CSV</h3></div>
                  <a className="text-link" href={`${import.meta.env.BASE_URL}skills-standings.csv`} download>Download file <ArrowRight size={14} /></a>
                </div>
                <div className="source-details">
                  <span>{standings.length.toLocaleString()} teams in this snapshot</span>
                  <span>Latest recorded score: {formatSnapshotDate(snapshotDate)}</span>
                </div>
              </section>

              <footer className="page-footer"><span>SCOUTLINE <span className="footer-dot">•</span> VEX V5 TEAM INTELLIGENCE</span><span>Scores reflect the supplied CSV snapshot, not a live feed.</span></footer>
            </>
          ) : (
            <section className="empty-state">
              <div className="empty-icon"><Search size={23} /></div>
              <h2>Team not in this snapshot</h2>
              <p>{notice || `${selectedNumber} is not listed in the supplied skills standings file. Try another team number.`}</p>
              <button className="search-button" onClick={showExample}>View example team <ArrowRight size={16} /></button>
            </section>
          )}
        </div>
      </main>
    </div>
  );
}

export default App;
