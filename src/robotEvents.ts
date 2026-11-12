const API_BASE = "https://events.vex.com/api/v2";
const V5RC_PROGRAM_ID = 1;
const MAX_PAGES = 20;
const PAGE_SIZE = 250;

interface PageMeta {
  last_page?: number;
  total?: number;
}

interface ApiPage<T> {
  data?: T[];
  meta?: PageMeta;
  message?: string;
}

interface IdInfo {
  id?: number;
  name?: string;
}

interface ApiLocation {
  city?: string;
  region?: string;
  country?: string;
}

interface ApiTeam {
  id: number;
  number: string;
  team_name?: string;
  organization?: string;
  location?: ApiLocation;
  grade?: string;
  robot_name?: string;
  program?: IdInfo;
}

interface ApiEvent {
  id: number;
  name: string;
  start?: string;
  end?: string;
  location?: ApiLocation;
  divisions?: Array<{ id: number; name: string }>;
}

interface ApiAward {
  id: number;
  title?: string;
  event?: IdInfo;
  classification?: string | null;
  designation?: string | null;
}

interface ApiSkill {
  id: number;
  event?: IdInfo;
  type?: string;
  score?: number;
  rank?: number;
}

interface ApiAlliance {
  color: string;
  score: number;
  teams: Array<{ team?: IdInfo }>;
}

interface ApiMatch {
  id: number;
  event?: IdInfo;
  name?: string;
  round?: number;
  matchnum?: number;
  scored?: boolean;
  alliances?: ApiAlliance[];
}

interface ApiRanking {
  id: number;
  event?: IdInfo;
  rank?: number;
  wins?: number;
  losses?: number;
  ties?: number;
}

export interface LiveAward {
  name: string;
  event: string;
  date: string;
}

export interface LiveTournament {
  id: number;
  name: string;
  location: string;
  date: string;
  year: string;
  placement: string;
  record: string | null;
  award?: string;
  programmingSkills: number | null;
  driverSkills: number | null;
  programmingSkillsRuns: number;
  driverSkillsRuns: number;
  matches: LiveMatchResult[];
}

export interface LiveMatchResult {
  id: number;
  round: number;
  matchnum: number;
  name: string;
  result: "Win" | "Loss" | "Tie";
  teamScore: number;
  opponentScore: number;
}

export interface LiveTeamDetails {
  fetchedAt: string;
  number: string;
  name: string;
  organization: string;
  location: string;
  grade: string;
  events: number;
  wins: number;
  losses: number;
  ties: number;
  skillsRank: number | null;
  skills: { programming: number; driver: number; combined: number };
  skillsByYear: Record<string, {
    programming: number | null;
    driver: number | null;
    combined: number | null;
    rank: number | null;
    programmingRuns: number;
    driverRuns: number;
  }>;
  coverage: {
    events: number;
    programmingRuns: number;
    driverRuns: number;
    scoredMatches: number;
    eventsWithScoredMatches: number;
  };
  awards: LiveAward[];
  tournaments: LiveTournament[];
}

export class RobotEventsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RobotEventsError";
  }
}

async function fetchWithRetry(url: string, init: RequestInit): Promise<Response> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    let response: Response;
    try {
      response = await fetch(url, init);
    } catch {
      if (attempt === 2) {
        throw new RobotEventsError("Could not reach RobotEvents after retrying. Check your connection and try again.");
      }
      await new Promise((resolve) => window.setTimeout(resolve, 500 * (attempt + 1)));
      continue;
    }

    if (response.ok || (response.status !== 429 && response.status < 500)) return response;
    if (attempt === 2) return response;

    const retryAfter = response.headers.get("Retry-After");
    const retryAfterDate = retryAfter ? Date.parse(retryAfter) : Number.NaN;
    const retryDelay = retryAfter && /^\d+$/.test(retryAfter)
      ? Math.min(Number(retryAfter) * 1000, 30000)
      : Number.isFinite(retryAfterDate)
        ? Math.min(Math.max(0, retryAfterDate - Date.now()), 30000)
        : 500 * (attempt + 1);
    await new Promise((resolve) => window.setTimeout(resolve, retryDelay));
  }
  throw new RobotEventsError("Could not reach RobotEvents after retrying. Check your connection and try again.");
}

async function getJson<T>(path: string, token: string, params = new URLSearchParams()): Promise<T> {
  const query = params.toString();
  let response: Response;
  try {
    response = await fetchWithRetry(`${API_BASE}${path}${query ? `?${query}` : ""}`, {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
      },
    });
  } catch (error) {
    if (error instanceof RobotEventsError) throw error;
    throw new RobotEventsError("Could not reach RobotEvents. Check your connection and try again.");
  }

  if (response.status === 401 || response.status === 403) {
    throw new RobotEventsError("RobotEvents rejected the API key. Check that it is valid and try again.");
  }
  if (response.status === 404) {
    throw new RobotEventsError("The requested team or RobotEvents API endpoint was not found.");
  }
  if (response.status === 429) {
    throw new RobotEventsError("RobotEvents rate-limited this request after automatic retries. Wait a moment and retry.");
  }
  if (!response.ok) {
    throw new RobotEventsError(`RobotEvents request failed (HTTP ${response.status}).`);
  }

  try {
    return await response.json() as T;
  } catch {
    throw new RobotEventsError("RobotEvents returned an unexpected response. Check the API key and try again.");
  }
}

export async function validateRobotEventsKey(token: string): Promise<void> {
  await getJson<IdInfo>("/programs/1", token);
}

async function getAllPages<T>(
  path: string,
  token: string,
  initialParams = new URLSearchParams(),
): Promise<T[]> {
  const results: T[] = [];
  let lastPage = 1;

  for (let page = 1; page <= lastPage; page += 1) {
    const params = new URLSearchParams(initialParams);
    params.set("per_page", String(PAGE_SIZE));
    params.set("page", String(page));
    const response = await getJson<ApiPage<T>>(path, token, params);
    if (!Array.isArray(response.data)) {
      throw new RobotEventsError("RobotEvents returned an invalid paginated response.");
    }
    results.push(...response.data);
    lastPage = response.meta?.last_page ?? 1;
    if (lastPage > MAX_PAGES) {
      throw new RobotEventsError(
        "This team's history exceeds the safe page limit. Refine the lookup or try again later.",
      );
    }
  }
  return results;
}

function formatDate(value?: string): string {
  if (!value) return "Date unavailable";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Date unavailable";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeZone: "UTC" }).format(date);
}

function formatLocation(location?: ApiLocation): string {
  return [location?.city, location?.region, location?.country].filter(Boolean).join(", ") || "Location unavailable";
}

export async function lookupRobotEventsTeam(token: string, teamNumber: string): Promise<LiveTeamDetails | null> {
  const teamParams = new URLSearchParams();
  teamParams.append("number[]", teamNumber);
  teamParams.append("program[]", String(V5RC_PROGRAM_ID));
  const teams = await getAllPages<ApiTeam>("/teams", token, teamParams);
  const team = teams.find((candidate) => candidate.number.toUpperCase() === teamNumber);
  if (!team) return null;

  const [events, awards, skills, matches, rankings] = await Promise.all([
    getAllPages<ApiEvent>(`/teams/${team.id}/events`, token),
    getAllPages<ApiAward>(`/teams/${team.id}/awards`, token),
    getAllPages<ApiSkill>(`/teams/${team.id}/skills`, token),
    getAllPages<ApiMatch>(`/teams/${team.id}/matches`, token),
    getAllPages<ApiRanking>(`/teams/${team.id}/rankings`, token),
  ]);
  const eventById = new Map(events.map((event) => [event.id, event]));

  const programmingScores = skills.filter((skill) => skill.type === "programming").map((skill) => skill.score ?? 0);
  const driverScores = skills.filter((skill) => skill.type === "driver").map((skill) => skill.score ?? 0);
  const skillsByEvent = new Map<number, {
    programming: number[];
    driver: number[];
    ranks: number[];
  }>();
  for (const skill of skills) {
    if (!skill.event?.id) continue;
    const eventSkills = skillsByEvent.get(skill.event.id) ?? { programming: [], driver: [], ranks: [] };
    if (skill.type === "programming") eventSkills.programming.push(skill.score ?? 0);
    if (skill.type === "driver") eventSkills.driver.push(skill.score ?? 0);
    if (skill.rank && skill.rank > 0) eventSkills.ranks.push(skill.rank);
    skillsByEvent.set(skill.event.id, eventSkills);
  }
  const awardsByEvent = new Map<number, string[]>();
  const liveAwards = awards.map((award): LiveAward => {
    if (award.event?.id && award.title) {
      const eventAwards = awardsByEvent.get(award.event.id) ?? [];
      eventAwards.push(award.title);
      awardsByEvent.set(award.event.id, eventAwards);
    }
    return {
      name: award.title || "Award",
      event: award.event?.name || "Event unavailable",
      date: formatDate(award.event?.id ? eventById.get(award.event.id)?.start : undefined),
    };
  });

  const recordByEvent = new Map<number, { wins: number; losses: number; ties: number }>();
  const matchesByEvent = new Map<number, LiveMatchResult[]>();
  for (const match of matches) {
    if (
      !match.scored ||
      match.round === 1 ||
      !match.event?.id ||
      !match.alliances ||
      match.alliances.length < 2
    ) {
      continue;
    }
    const teamAlliance = match.alliances.find((alliance) =>
      alliance.teams.some((entry) => entry.team?.id === team.id || entry.team?.name === team.number),
    );
    if (!teamAlliance) continue;
    const otherAlliance = match.alliances.find((alliance) => alliance !== teamAlliance);
    if (!otherAlliance) continue;
    const record = recordByEvent.get(match.event.id) ?? { wins: 0, losses: 0, ties: 0 };
    const result = teamAlliance.score > otherAlliance.score
      ? "Win"
      : teamAlliance.score < otherAlliance.score
        ? "Loss"
        : "Tie";
    if (result === "Win") record.wins += 1;
    else if (result === "Loss") record.losses += 1;
    else record.ties += 1;
    recordByEvent.set(match.event.id, record);
    const eventMatches = matchesByEvent.get(match.event.id) ?? [];
    eventMatches.push({
      id: match.id,
      round: match.round ?? 0,
      matchnum: match.matchnum ?? 0,
      name: match.name || `Round ${match.round ?? "?"} · Match ${match.matchnum ?? "?"}`,
      result,
      teamScore: teamAlliance.score,
      opponentScore: otherAlliance.score,
    });
    matchesByEvent.set(match.event.id, eventMatches);
  }

  const rankingByEvent = new Map<number, ApiRanking>();
  for (const ranking of rankings) {
    if (
      ranking.event?.id &&
      (!rankingByEvent.has(ranking.event.id) ||
        (ranking.rank ?? Infinity) <
          (rankingByEvent.get(ranking.event.id)?.rank ?? Infinity))
    ) {
      rankingByEvent.set(ranking.event.id, ranking);
    }
  }

  const tournaments = events
    .slice()
    .sort((a, b) => Date.parse(b.start ?? "") - Date.parse(a.start ?? ""))
    .map((event): LiveTournament => {
      const record = recordByEvent.get(event.id);
      const ranking = rankingByEvent.get(event.id);
      const eventSkills = skillsByEvent.get(event.id);
      return {
        id: event.id,
        name: event.name,
        location: formatLocation(event.location),
        date: formatDate(event.start),
        year: event.start && !Number.isNaN(Date.parse(event.start))
          ? String(new Date(event.start).getUTCFullYear())
          : "",
        placement: ranking?.rank ? `#${ranking.rank}` : "—",
        record: record ? `${record.wins}–${record.losses}–${record.ties}` : null,
        award: awardsByEvent.get(event.id)?.join(", "),
        programmingSkills: eventSkills?.programming.length
          ? Math.max(...eventSkills.programming)
          : null,
        driverSkills: eventSkills?.driver.length
          ? Math.max(...eventSkills.driver)
          : null,
        programmingSkillsRuns: eventSkills?.programming.length ?? 0,
        driverSkillsRuns: eventSkills?.driver.length ?? 0,
        matches: (matchesByEvent.get(event.id) ?? []).sort(
          (left, right) => left.round - right.round || left.matchnum - right.matchnum,
        ),
      };
    });

  const skillsByYear: LiveTeamDetails["skillsByYear"] = {};
  for (const event of tournaments) {
    if (!event.year) continue;
    const yearSkills = skillsByYear[event.year] ?? {
      programming: null,
      driver: null,
      combined: null,
      rank: null,
      programmingRuns: 0,
      driverRuns: 0,
    };
    const eventSkills = skillsByEvent.get(event.id);
    if (eventSkills?.programming.length) {
      const score = Math.max(...eventSkills.programming);
      yearSkills.programming = Math.max(yearSkills.programming ?? 0, score);
      yearSkills.programmingRuns += eventSkills.programming.length;
    }
    if (eventSkills?.driver.length) {
      const score = Math.max(...eventSkills.driver);
      yearSkills.driver = Math.max(yearSkills.driver ?? 0, score);
      yearSkills.driverRuns += eventSkills.driver.length;
    }
    if (eventSkills?.ranks.length) {
      yearSkills.rank = Math.min(yearSkills.rank ?? Infinity, ...eventSkills.ranks);
    }
    yearSkills.combined = yearSkills.programming !== null && yearSkills.driver !== null
      ? yearSkills.programming + yearSkills.driver
      : null;
    skillsByYear[event.year] = yearSkills;
  }
  for (const yearSkills of Object.values(skillsByYear)) {
    if (yearSkills.rank === Infinity) yearSkills.rank = null;
  }

  const teamProgramming = programmingScores.length ? Math.max(...programmingScores) : 0;
  const teamDriver = driverScores.length ? Math.max(...driverScores) : 0;
  const topSkillRank = skills.reduce((rank, skill) => Math.min(rank, skill.rank || Infinity), Infinity);
  const winTotal = [...recordByEvent.values()].reduce((total, record) => total + record.wins, 0);
  const lossTotal = [...recordByEvent.values()].reduce((total, record) => total + record.losses, 0);
  const tieTotal = [...recordByEvent.values()].reduce((total, record) => total + record.ties, 0);

  return {
    fetchedAt: new Date().toISOString(),
    number: team.number,
    name: team.team_name || team.number,
    organization: team.organization || "",
    location: formatLocation(team.location),
    grade: team.grade || "",
    events: events.length,
    wins: winTotal,
    losses: lossTotal,
    ties: tieTotal,
    skillsRank: Number.isFinite(topSkillRank) ? topSkillRank : null,
    skills: {
      programming: teamProgramming,
      driver: teamDriver,
      combined: teamProgramming + teamDriver,
    },
    skillsByYear,
    coverage: {
      events: events.length,
      programmingRuns: programmingScores.length,
      driverRuns: driverScores.length,
      scoredMatches: matchesByEvent.size === 0
        ? 0
        : [...matchesByEvent.values()].reduce((total, eventMatches) => total + eventMatches.length, 0),
      eventsWithScoredMatches: matchesByEvent.size,
    },
    awards: liveAwards,
    tournaments,
  };
}
