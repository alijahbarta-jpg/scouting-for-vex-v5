import { useEffect, useState, type FormEvent } from "react";
import {
  ArrowRight,
  Award as AwardIcon,
  Check,
  ChevronDown,
  CircleHelp,
  ClipboardCopy,
  Compass,
  Download,
  ExternalLink,
  KeyRound,
  MapPin,
  Plus,
  RefreshCw,
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

interface SkillBarProps {
  label: string;
  value: number;
  max: number;
  color: string;
  scaleLabel?: string;
}

interface ComparisonMetric {
  label: string;
  getValue: (team: ComparisonTeam) => number | null;
  format: (value: number) => string;
  higherIsBetter: boolean;
}

interface ComparisonTeam {
  number: string;
  name: string;
  snapshot: SkillsStanding | null;
  live: LiveTeamDetails | null;
}

interface TeamScoutNotes {
  notes: string;
  tags: string[];
}

type ComparisonSource = "snapshot" | "live";
type ComparisonView = "skills" | "event";
type LiveLoadStatus = "loading" | "loaded" | "error" | "missing";
type ActiveWorkspace = "search" | "compare";
const scoutTags = ["Strong autonomous", "Consistent", "Fast cycles", "Defensive", "Reliable", "Needs review"];
const scoutNotesStorageKey = "scoutline-team-notes-v1";

function comparisonNumbersFromUrl(): string[] {
  const validNumbers = new URLSearchParams(window.location.search)
    .get("compare")
    ?.split(",")
    .map((number) => number.trim().toUpperCase())
    .filter((number) => /^\d{1,6}[A-Z]{0,2}$/.test(number)) ?? [];
  const uniqueNumbers = [...new Set(validNumbers)].slice(0, 4);
  return uniqueNumbers.length > 0
    ? [...uniqueNumbers, ...Array(Math.max(0, 2 - uniqueNumbers.length)).fill("")]
    : [exampleTeamNumber, ""];
}

function escapeCsv(value: string | number): string {
  const rawText = String(value);
  const text = /^[=+\-@]/.test(rawText) ? `'${rawText}` : rawText;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function loadScoutNotes(): Record<string, TeamScoutNotes> {
  try {
    const stored = window.localStorage.getItem(scoutNotesStorageKey);
    if (!stored) return {};
    const parsed: unknown = JSON.parse(stored);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const notes: Record<string, TeamScoutNotes> = {};
    for (const [teamNumber, value] of Object.entries(parsed)) {
      if (!value || typeof value !== "object" || Array.isArray(value)) continue;
      const entry = value as Record<string, unknown>;
      notes[teamNumber] = {
        notes: typeof entry.notes === "string" ? entry.notes : "",
        tags: Array.isArray(entry.tags)
          ? entry.tags.filter((tag): tag is string => typeof tag === "string" && scoutTags.includes(tag))
          : [],
      };
    }
    return notes;
  } catch {
    return {};
  }
}

function formatLiveCoverage(team: ComparisonTeam, year: string): string {
  if (!team.live) return "Not loaded";
  if (year === "all") {
    const coverage = team.live.coverage;
    return `${coverage.events} events · ${coverage.programmingRuns} programming / ${coverage.driverRuns} driver runs · ${coverage.scoredMatches} scored matches`;
  }
  const yearEvents = team.live.tournaments.filter((event) => event.year === year);
  const skills = team.live.skillsByYear[year];
  const scoredMatches = yearEvents.reduce((total, event) => total + event.matches.length, 0);
  return `${yearEvents.length} events · ${skills?.programmingRuns ?? 0} programming / ${skills?.driverRuns ?? 0} driver runs · ${scoredMatches} scored matches`;
}

function SkillBar({
  label,
  value,
  max,
  color,
  scaleLabel = "in snapshot",
}: SkillBarProps) {
  return (
    <div className="skill-row">
      <div className="skill-label">
        <span>{label}</span>
        <span className="skill-score">
          {value}
          <span className="score-max"> / {max} {scaleLabel}</span>
        </span>
      </div>
      <div className="skill-track">
        <div
          className={`skill-fill ${color}`}
          style={{ width: `${max ? (value / max) * 100 : 0}%` }}
        />
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
  const [comparisonNumbers, setComparisonNumbers] = useState(comparisonNumbersFromUrl);
  const [comparisonSource, setComparisonSource] = useState<ComparisonSource>(() =>
    new URLSearchParams(window.location.search).get("compareSource") === "live" ? "live" : "snapshot",
  );
  const [comparisonView, setComparisonView] = useState<ComparisonView>(() =>
    new URLSearchParams(window.location.search).get("compareView") === "event" ? "event" : "skills",
  );
  const [comparisonYear, setComparisonYear] = useState(() => {
    const year = new URLSearchParams(window.location.search).get("year");
    return year && /^\d{4}$/.test(year) ? year : "all";
  });
  const [comparisonEventId, setComparisonEventId] = useState(() =>
    new URLSearchParams(window.location.search).get("event") ?? "",
  );
  const [comparisonError, setComparisonError] = useState("");
  const [comparisonSearchIndex, setComparisonSearchIndex] = useState<number | null>(null);
  const [suggestionActiveIndex, setSuggestionActiveIndex] = useState(-1);
  const [mainSearchOpen, setMainSearchOpen] = useState(false);
  const [mainSearchActiveIndex, setMainSearchActiveIndex] = useState(-1);
  const [activeWorkspace, setActiveWorkspace] = useState<ActiveWorkspace>("search");
  const [liveComparisonTeams, setLiveComparisonTeams] = useState<Record<string, LiveTeamDetails>>({});
  const [liveLoadStatuses, setLiveLoadStatuses] = useState<Record<string, LiveLoadStatus>>({});
  const [liveComparisonLoading, setLiveComparisonLoading] = useState(false);
  const [scoutNotes, setScoutNotes] = useState<Record<string, TeamScoutNotes>>(loadScoutNotes);
  const [scoutNotesError, setScoutNotesError] = useState(() => {
    try {
      window.localStorage.getItem(scoutNotesStorageKey);
      return "";
    } catch {
      return "Notes are unavailable because this browser blocks local storage.";
    }
  });
  const [eventSearch, setEventSearch] = useState("");
  const [eventYearFilter, setEventYearFilter] = useState("all");
  const [eventLocationFilter, setEventLocationFilter] = useState("");
  const [shareCopied, setShareCopied] = useState(false);
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

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const selected = comparisonNumbers
      .map((number) => number.trim().toUpperCase())
      .filter((number) => /^\d{1,6}[A-Z]{0,2}$/.test(number));
    if (selected.length > 0) params.set("compare", [...new Set(selected)].join(","));
    else params.delete("compare");
    params.set("compareSource", comparisonSource);
    params.set("compareView", comparisonView);
    if (comparisonYear !== "all") params.set("year", comparisonYear);
    else params.delete("year");
    if (comparisonEventId) params.set("event", comparisonEventId);
    else params.delete("event");
    const queryString = params.toString();
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}${queryString ? `?${queryString}` : ""}${window.location.hash}`,
    );
  }, [comparisonNumbers, comparisonSource, comparisonView, comparisonEventId, comparisonYear]);

  useEffect(() => {
    const comparisonPanel = document.getElementById("team-comparison");
    if (!comparisonPanel || !("IntersectionObserver" in window)) return;
    const observer = new IntersectionObserver(
      ([entry]) => setActiveWorkspace(entry.isIntersecting ? "compare" : "search"),
      { rootMargin: "-12% 0px -72% 0px" },
    );
    observer.observe(comparisonPanel);
    return () => observer.disconnect();
  }, []);

  const team = standings.find((standing) => standing.teamNumber === selectedNumber) ?? null;
  const teamPageNumber = liveTeam?.number ?? team?.teamNumber;
  const highestProgramming = Math.max(0, ...standings.map((standing) => standing.highestProgramming));
  const highestDriver = Math.max(0, ...standings.map((standing) => standing.highestDriver));
  const mainSearchTerm = query.trim().toLowerCase();
  const mainSearchSuggestions = mainSearchTerm && !standings.some(
    (standing) => standing.teamNumber === mainSearchTerm.toUpperCase(),
  )
    ? standings.filter((standing) =>
      `${standing.teamNumber} ${standing.teamName} ${standing.organization}`
        .toLowerCase()
        .includes(mainSearchTerm),
    ).slice(0, 6)
    : [];
  const comparisonTeams: ComparisonTeam[] = [...new Set(
    comparisonNumbers
      .map((number) => number.trim().toUpperCase())
      .filter((number) => /^\d{1,6}[A-Z]{0,2}$/.test(number)),
  )].map((number) => {
    const snapshot = standings.find((standing) => standing.teamNumber === number) ?? null;
    const live = liveComparisonTeams[number] ?? null;
    return {
      number,
      name: snapshot?.teamName || live?.name || "Live team",
      snapshot,
      live,
    };
  });
  const loadedLiveComparisonCount = comparisonTeams.filter((comparisonTeam) => comparisonTeam.live).length;
  const currentSourceLabel = activeWorkspace === "compare"
    ? comparisonView === "event" || comparisonSource === "live"
      ? `RobotEvents live · ${loadedLiveComparisonCount === 0 ? "no data" : `${loadedLiveComparisonCount}/${comparisonTeams.length} loaded`}`
      : "Skills snapshot"
    : liveTeam ? "RobotEvents live" : "Skills snapshot";
  const comparisonMetrics: ComparisonMetric[] = comparisonSource === "snapshot" ? [
    {
      label: "Skills rank",
      getValue: (team) =>
        team.snapshot && (comparisonYear === "all" || team.snapshot.latestScoreAt.slice(0, 4) === comparisonYear)
          ? team.snapshot.rank
          : null,
      format: (value) => `#${value}`,
      higherIsBetter: false,
    },
    {
      label: "Combined skills score",
      getValue: (team) =>
        team.snapshot && (comparisonYear === "all" || team.snapshot.latestScoreAt.slice(0, 4) === comparisonYear)
          ? team.snapshot.score
          : null,
      format: (value) => `${value} pts`,
      higherIsBetter: true,
    },
    {
      label: "Programming skills",
      getValue: (team) =>
        team.snapshot && (comparisonYear === "all" || team.snapshot.latestScoreAt.slice(0, 4) === comparisonYear)
          ? team.snapshot.programming
          : null,
      format: (value) => `${value} pts`,
      higherIsBetter: true,
    },
    {
      label: "Driver skills",
      getValue: (team) =>
        team.snapshot && (comparisonYear === "all" || team.snapshot.latestScoreAt.slice(0, 4) === comparisonYear)
          ? team.snapshot.driver
          : null,
      format: (value) => `${value} pts`,
      higherIsBetter: true,
    },
    {
      label: "Best programming run",
      getValue: (team) =>
        team.snapshot && (comparisonYear === "all" || team.snapshot.latestScoreAt.slice(0, 4) === comparisonYear)
          ? team.snapshot.highestProgramming
          : null,
      format: (value) => `${value} pts`,
      higherIsBetter: true,
    },
    {
      label: "Best driver run",
      getValue: (team) =>
        team.snapshot && (comparisonYear === "all" || team.snapshot.latestScoreAt.slice(0, 4) === comparisonYear)
          ? team.snapshot.highestDriver
          : null,
      format: (value) => `${value} pts`,
      higherIsBetter: true,
    },
  ] : [
    {
      label: "Best recorded run rank",
      getValue: (team) => comparisonYear === "all"
        ? team.live?.skillsRank ?? null
        : team.live?.skillsByYear[comparisonYear]?.rank ?? null,
      format: (value) => `#${value}`,
      higherIsBetter: false,
    },
    {
      label: "Combined skills score",
      getValue: (team) => {
        if (comparisonYear === "all") {
          const live = team.live;
          return live?.coverage.programmingRuns && live.coverage.driverRuns
            ? live.skills.combined
            : null;
        }
        const skills = team.live?.skillsByYear[comparisonYear];
        return skills?.programmingRuns && skills.driverRuns ? skills.combined : null;
      },
      format: (value) => `${value} pts`,
      higherIsBetter: true,
    },
    {
      label: "Best programming score",
      getValue: (team) => {
        const hasRuns = comparisonYear === "all"
          ? Boolean(team.live?.coverage.programmingRuns)
          : Boolean(team.live?.skillsByYear[comparisonYear]?.programmingRuns);
        return hasRuns
          ? comparisonYear === "all"
            ? team.live?.skills.programming ?? null
            : team.live?.skillsByYear[comparisonYear]?.programming ?? null
          : null;
      },
      format: (value) => `${value} pts`,
      higherIsBetter: true,
    },
    {
      label: "Best driver score",
      getValue: (team) => {
        const hasRuns = comparisonYear === "all"
          ? Boolean(team.live?.coverage.driverRuns)
          : Boolean(team.live?.skillsByYear[comparisonYear]?.driverRuns);
        return hasRuns
          ? comparisonYear === "all"
            ? team.live?.skills.driver ?? null
            : team.live?.skillsByYear[comparisonYear]?.driver ?? null
          : null;
      },
      format: (value) => `${value} pts`,
      higherIsBetter: true,
    },
    {
      label: "Events attended",
      getValue: (team) => comparisonYear === "all"
        ? team.live?.events ?? null
        : team.live?.tournaments.filter((event) => event.year === comparisonYear).length ?? null,
      format: (value) => String(value),
      higherIsBetter: true,
    },
    {
      label: "Match win rate",
      getValue: (team) => {
        const live = team.live;
        if (comparisonYear !== "all") {
          const records = live?.tournaments
            .filter((event) => event.year === comparisonYear)
            .map((event) => event.record)
            .filter((record): record is string => Boolean(record)) ?? [];
          const { wins, matches } = records.reduce(
            (total, record) => {
              const [wins, losses, ties] = record.split(/[–-]/).map(Number);
              return {
                wins: total.wins + wins,
                matches: total.matches + wins + losses + ties,
              };
            },
            { wins: 0, matches: 0 },
          );
          return matches > 0 ? (wins / matches) * 100 : null;
        }
        const total = live ? live.wins + live.losses + live.ties : 0;
        return total > 0 && live ? (live.wins / total) * 100 : null;
      },
      format: (value) => `${value.toFixed(1)}%`,
      higherIsBetter: true,
    },
  ];
  const comparisonYears = [...new Set([
    ...standings.map((standing) => standing.latestScoreAt.slice(0, 4)),
    ...comparisonTeams.flatMap((team) => team.live?.tournaments.map((event) => event.year) ?? []),
  ].filter((year) => /^\d{4}$/.test(year)))].sort((a, b) => b.localeCompare(a));
  const allComparisonEvents = [...new Map(
    comparisonTeams.flatMap((team) =>
      (team.live?.tournaments ?? []).map((event) => [String(event.id), event.name] as const),
    ),
  )].map(([id, name]) => ({ id, name }));
  const comparisonEvents = allComparisonEvents.filter((option) => {
    const event = comparisonTeams.flatMap((team) => team.live?.tournaments ?? [])
      .find((item) => String(item.id) === option.id);
    const search = eventSearch.trim().toLowerCase();
    const matchesText = !search ||
      `${event?.name ?? ""} ${event?.location ?? ""}`.toLowerCase().includes(search);
    return (comparisonYear === "all" || event?.year === comparisonYear) && matchesText;
  });
  const selectedComparisonEvent = comparisonTeams
    .flatMap((team) => team.live?.tournaments ?? [])
    .find((event) => String(event.id) === comparisonEventId);
  const comparisonEventMatches = [...new Map(
    comparisonTeams.flatMap((team) =>
      (team.live?.tournaments.find((event) => String(event.id) === comparisonEventId)?.matches ?? [])
        .map((match) => [match.id, match] as const),
    ),
  ).values()].sort((left, right) => left.round - right.round || left.matchnum - right.matchnum);
  const fetchedTimestamps = comparisonTeams
    .map((team) => team.live?.fetchedAt)
    .filter((timestamp): timestamp is string => Boolean(timestamp))
    .sort();
  const comparisonFetchedAt = fetchedTimestamps[fetchedTimestamps.length - 1];

  useEffect(() => {
    if (!allComparisonEvents.length) return;
    if (comparisonEventId && !comparisonEvents.some((event) => event.id === comparisonEventId)) {
      setComparisonEventId(comparisonEvents[0]?.id ?? "");
    } else if (!comparisonEventId && comparisonEvents.length > 0) {
      setComparisonEventId(comparisonEvents[0].id);
    }
  }, [allComparisonEvents.length, comparisonEventId, comparisonEvents.map((event) => event.id).join(",")]);

  useEffect(() => {
    try {
      window.localStorage.setItem(scoutNotesStorageKey, JSON.stringify(scoutNotes));
      setScoutNotesError("");
    } catch {
      setScoutNotesError("Notes could not be saved in this browser. Check available local storage.");
    }
  }, [scoutNotes]);

  const teamEvents = liveTeam?.tournaments ?? [];
  const eventYears = [...new Set(teamEvents.map((event) => event.year).filter(Boolean))]
    .sort((a, b) => b.localeCompare(a));
  const filteredTeamEvents = teamEvents.filter((event) => {
    const matchesYear = eventYearFilter === "all" || event.year === eventYearFilter;
    const search = eventLocationFilter.trim().toLowerCase();
    const matchesText = !search ||
      `${event.name} ${event.location}`.toLowerCase().includes(search);
    return matchesYear && matchesText;
  });

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
    setMainSearchOpen(false);
    void searchTeamNumber(query.trim().toUpperCase());
  }

  function selectMainSearchSuggestion(teamNumber: string) {
    setQuery(teamNumber);
    setMainSearchOpen(false);
    setMainSearchActiveIndex(-1);
    setApiKeyError("");
    void searchTeamNumber(teamNumber);
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
      if (token !== apiKey) {
        setLiveComparisonTeams({});
        setLiveLoadStatuses({});
      }
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
    setMainSearchActiveIndex(-1);
    setMainSearchOpen(Boolean(value.trim()));
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

  function updateComparisonTeam(index: number, teamNumber: string) {
    const normalized = teamNumber.trim().toUpperCase();
    const isTeamNumber = /^\d{1,6}[A-Z]{0,2}$/.test(normalized);
    if (
      isTeamNumber &&
      comparisonNumbers.some((number, slot) => slot !== index && number.trim().toUpperCase() === normalized)
    ) {
      setComparisonError(`${normalized} is already in this comparison.`);
      return;
    }
    setComparisonError("");
    setComparisonNumbers((current) =>
      current.map((number, slot) => (slot === index ? normalized : number)),
    );
  }

  async function loadLiveComparison(forceNumbers: string[] = []) {
    if (!apiKey) {
      setComparisonError("Connect a RobotEvents API key above to load live comparison data.");
      return;
    }
    const requestedTeams = comparisonTeams.filter(
      (team) => forceNumbers.includes(team.number) || !liveComparisonTeams[team.number],
    );
    if (requestedTeams.length === 0) {
      setComparisonError("Add at least one valid team number before loading live data.");
      return;
    }
    if (forceNumbers.length !== 1 && comparisonTeams.length < 2) {
      setComparisonError("Add at least two valid team numbers before loading live data.");
      return;
    }
    setComparisonError("");
    setLiveComparisonLoading(true);
    const results: Array<{ number: string; details: LiveTeamDetails | null; error: string }> = [];
    setLiveLoadStatuses((current) => {
      const updated = { ...current };
      for (const team of requestedTeams) updated[team.number] = "loading";
      return updated;
    });
    try {
      for (const team of requestedTeams) {
        if (liveComparisonTeams[team.number] && !forceNumbers.includes(team.number)) continue;
        try {
          const details = await lookupRobotEventsTeam(apiKey, team.number);
          results.push({ number: team.number, details, error: "" });
        } catch (error) {
          results.push({
            number: team.number,
            details: null,
            error: error instanceof Error ? error.message : `Could not load ${team.number}.`,
          });
        }
      }
      setLiveComparisonTeams((current) => {
        const updated = { ...current };
        for (const result of results) {
          if (result.details) updated[result.number] = result.details;
          else if (!result.error) delete updated[result.number];
        }
        return updated;
      });
      setLiveLoadStatuses((current) => {
        const updated = { ...current };
        for (const result of results) {
          updated[result.number] = result.details ? "loaded" : result.error ? "error" : "missing";
        }
        return updated;
      });
      const failures = results.flatMap((result) => {
        if (result.error) return [`${result.number}: ${result.error}`];
        if (!result.details) return [`${result.number}: not found in RobotEvents.`];
        return [];
      });
      setComparisonError(failures.join(" "));
    } finally {
      setLiveComparisonLoading(false);
    }
  }

  function updateScoutNotes(teamNumber: string, updates: Partial<TeamScoutNotes>) {
    setScoutNotes((current) => ({
      ...current,
      [teamNumber]: {
        notes: current[teamNumber]?.notes ?? "",
        tags: current[teamNumber]?.tags ?? [],
        ...updates,
      },
    }));
  }

  function toggleScoutTag(teamNumber: string, tag: string) {
    const currentTags = scoutNotes[teamNumber]?.tags ?? [];
    updateScoutNotes(teamNumber, {
      tags: currentTags.includes(tag)
        ? currentTags.filter((currentTag) => currentTag !== tag)
        : [...currentTags, tag],
    });
  }

  async function copyComparisonLink() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setShareCopied(true);
      window.setTimeout(() => setShareCopied(false), 2000);
    } catch {
      setComparisonError("Could not copy the link. Copy the page URL from your browser instead.");
    }
  }

  function downloadComparisonCsv() {
    const rows: Array<Array<string | number>> = [];
    if (comparisonView === "event") {
      rows.push(["Event comparison", selectedComparisonEvent?.name ?? comparisonEventId]);
      rows.push([
        "Data source",
        `RobotEvents live${comparisonFetchedAt ? ` · Retrieved ${comparisonFetchedAt}` : ""}`,
      ]);
      rows.push(["Team", "Placement", "Match record", "Win rate", "Award"]);
      for (const team of comparisonTeams) {
        const event = team.live?.tournaments.find((item) => String(item.id) === comparisonEventId);
        const record = event?.record ?? "";
        const scores = record ? record.split(/[–-]/).map(Number) : [];
        const matches = scores.reduce((sum, score) => sum + score, 0);
        rows.push([
          team.number,
          event?.placement ?? "No event data",
          record || "No scored matches",
          matches > 0 ? `${((scores[0] / matches) * 100).toFixed(1)}%` : "",
          event?.award ?? "",
        ]);
      }
      rows.push([]);
      rows.push(["Match", "Team", "Result", "Team score", "Opponent score"]);
      for (const match of comparisonEventMatches) {
        for (const team of comparisonTeams) {
          const result = team.live?.tournaments
            .find((event) => String(event.id) === comparisonEventId)
            ?.matches.find((item) => item.id === match.id);
          if (result) {
            rows.push([match.name, team.number, result.result, result.teamScore, result.opponentScore]);
          }
        }
      }
    } else {
      rows.push([comparisonSource === "snapshot" ? "Skills snapshot comparison" : "RobotEvents live comparison"]);
      rows.push([
        "Data freshness",
        comparisonSource === "snapshot"
          ? `Calendar year ${comparisonYear}; latest score ${snapshotDate || "unavailable"}`
          : `Latest team retrieval ${comparisonFetchedAt || "not loaded"}`,
      ]);
      rows.push(["Metric", ...comparisonTeams.map((team) => team.number)]);
      for (const metric of comparisonMetrics) {
        rows.push([
          metric.label,
          ...comparisonTeams.map((team) => {
            const value = metric.getValue(team);
            return value === null ? "" : metric.format(value);
          }),
        ]);
      }
    }
    const content = rows.map((row) => row.map(escapeCsv).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob([content], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `scoutline-${comparisonView}-comparison.csv`;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function scrollToComparison() {
    document.getElementById("team-comparison")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function scrollToSearch() {
    document.getElementById("team-search")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function openSnapshotComparison() {
    setComparisonView("skills");
    setComparisonSource("snapshot");
    scrollToComparison();
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="#" aria-label="Scoutline home" onClick={showExample}>
          <div className="brand-mark">
            <Compass size={21} strokeWidth={2.2} />
          </div>
          <span>
            scoutline<span className="brand-period">.</span>
          </span>
        </a>
        <div className="sidebar-section-label">WORKSPACE</div>
        <button
          className={activeWorkspace === "search" ? "nav-item active" : "nav-item"}
          aria-current={activeWorkspace === "search" ? "page" : undefined}
          onClick={scrollToSearch}
        >
          <Search size={17} /> <span>Team search</span>
        </button>
        <button
          className={activeWorkspace === "compare" ? "nav-item active" : "nav-item"}
          aria-current={activeWorkspace === "compare" ? "page" : undefined}
          onClick={scrollToComparison}
        >
          <Users size={17} /> <span>Compare teams</span>
        </button>
        <div className="sidebar-section-label seasons-label">DATA</div>
        <section className="sidebar-data-card" aria-label="Skills snapshot">
          <div className="sidebar-data-heading">
            <span>Skills snapshot</span>
            <span className="sidebar-data-badge">CSV</span>
          </div>
          <strong>{standings.length.toLocaleString()}</strong>
          <span className="sidebar-data-caption">
            {loading ? "Loading teams…" : loadError ? "Snapshot unavailable" : "teams in this dataset"}
          </span>
          <span className="sidebar-data-date">
            Updated {snapshotDate ? formatSnapshotDate(snapshotDate) : "date unavailable"}
          </span>
          <button type="button" onClick={openSnapshotComparison} disabled={!standings.length}>
            Compare snapshot
          </button>
          <a href={`${import.meta.env.BASE_URL}skills-standings.csv`} download>
            Download CSV <Download size={12} />
          </a>
        </section>
        <div className="sidebar-bottom">
          <div className="sidebar-callout">
            <div className="callout-icon">
              <CircleHelp size={17} />
            </div>
            <p>Need full event results?</p>
            <span>Open the team page for more details.</span>
            {(liveTeam || team) && (
              <a
                href={`https://events.vex.com/teams/V5RC/${encodeURIComponent(teamPageNumber ?? "")}`}
                target="_blank"
                rel="noreferrer"
              >
                VEX team page <ExternalLink size={13} />
              </a>
            )}
          </div>
          <div className="profile">
            <div className="avatar">SC</div>
            <div className="profile-copy">
              <strong>Scout crew</strong>
              <span>Team workspace</span>
            </div>
            <button className="icon-button profile-menu" aria-label="Workspace options">
              <ChevronDown size={16} />
            </button>
          </div>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div className="breadcrumbs">
            <span>Workspace</span>
            <span className="crumb-slash">/</span>
            <strong>{activeWorkspace === "compare" ? "Compare teams" : "Team search"}</strong>
          </div>
          <div className="topbar-right">
            <span className="season-pill"><span /> {currentSourceLabel}</span>
            <button className="icon-button help-button" aria-label="Help"><CircleHelp size={18} /></button>
          </div>
        </header>

        <div className="page-wrap">
          <section className="page-heading">
            <div>
              <div className="eyebrow"><span className="eyebrow-line" /> VEX V5 COMPETITION INTELLIGENCE</div>
              <h1>Look up a team in <span>seconds.</span></h1>
              <p className="page-intro">
                Search the built-in skills snapshot or connect RobotEvents for the full picture on a team.
              </p>
            </div>
          </section>

          <form className="search-panel" id="team-search" onSubmit={searchTeam}>
            <div className="search-field-wrap">
              <Search size={19} className="search-icon" />
              <input
                aria-label="VEX team number or team name"
                placeholder="Search by team number or team name"
                value={query}
                role="combobox"
                aria-autocomplete="list"
                aria-haspopup="listbox"
                aria-expanded={mainSearchOpen && mainSearchSuggestions.length > 0}
                aria-controls="main-team-suggestions"
                aria-activedescendant={
                  mainSearchOpen && mainSearchActiveIndex >= 0
                    ? `main-team-suggestion-${mainSearchActiveIndex}`
                    : undefined
                }
                autoComplete="off"
                onFocus={() => setMainSearchOpen(Boolean(query.trim()))}
                onBlur={() => window.setTimeout(() => setMainSearchOpen(false), 120)}
                onChange={(event) => handleSearchInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "ArrowDown" && mainSearchSuggestions.length > 0) {
                    event.preventDefault();
                    setMainSearchOpen(true);
                    setMainSearchActiveIndex((current) => Math.min(current + 1, mainSearchSuggestions.length - 1));
                  } else if (event.key === "ArrowUp" && mainSearchSuggestions.length > 0) {
                    event.preventDefault();
                    setMainSearchOpen(true);
                    setMainSearchActiveIndex((current) => Math.max(current - 1, 0));
                  } else if (
                    event.key === "Enter" &&
                    mainSearchOpen &&
                    mainSearchActiveIndex >= 0 &&
                    mainSearchSuggestions[mainSearchActiveIndex]
                  ) {
                    event.preventDefault();
                    selectMainSearchSuggestion(mainSearchSuggestions[mainSearchActiveIndex].teamNumber);
                  } else if (event.key === "Escape") {
                    setMainSearchOpen(false);
                    setMainSearchActiveIndex(-1);
                  }
                }}
              />
              {query && (
                <button
                  className="clear-search"
                  type="button"
                  aria-label="Clear search"
                  onClick={() => handleSearchInput("")}
                >
                  <X size={15} />
                </button>
              )}
              <span className="input-divider" />
              <span className="search-hint">TEAM OR NAME</span>
              {mainSearchOpen && mainSearchSuggestions.length > 0 && (
                <div
                  className="main-search-suggestions"
                  id="main-team-suggestions"
                  role="listbox"
                  aria-label="Matching teams"
                >
                  {mainSearchSuggestions.map((standing, index) => (
                    <button
                      key={standing.teamNumber}
                      type="button"
                      role="option"
                      id={`main-team-suggestion-${index}`}
                      aria-selected={index === mainSearchActiveIndex}
                      className={index === mainSearchActiveIndex ? "suggestion-active" : ""}
                      onMouseEnter={() => setMainSearchActiveIndex(index)}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => selectMainSearchSuggestion(standing.teamNumber)}
                    >
                      <strong>{standing.teamNumber}</strong>
                      <span>{standing.teamName}</span>
                      {standing.organization && <small>{standing.organization}</small>}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button
              className="search-button"
              type="submit"
              disabled={((loading || Boolean(loadError)) && !apiKey) || apiLoading}
            >
              {apiLoading ? "Fetching" : loading ? "Loading" : "Look it up"} <ArrowRight size={16} />
            </button>
          </form>

          <section className="api-key-panel">
            <div className="api-key-heading">
              <div className="api-key-icon">
                <KeyRound size={16} />
              </div>
              <div>
                <strong>Need live team details?</strong>
                <span>
                  Paste your RobotEvents API key to unlock awards, skills runs, match records, and event history.
                </span>
              </div>
              {apiKeyStatus && (
                <span className="api-connected">
                  <ShieldCheck size={14} /> {apiKeyStatus}
                </span>
              )}
            </div>
            {apiKey ? (
              <div className="api-key-connected-row">
                <span>
                  Your key is stored only in this page's memory and sent directly to RobotEvents for live lookups.
                </span>
                <button className="text-link" type="button" onClick={disconnectApiKey} disabled={liveComparisonLoading}>
                  Disconnect key
                </button>
              </div>
            ) : (
              <form className="api-key-form" onSubmit={connectApiKey}>
                <input
                  aria-label="RobotEvents API key"
                  autoComplete="off"
                  type="password"
                  placeholder="Paste your RobotEvents API key"
                  value={apiKeyDraft}
                  onChange={(event) => {
                    setApiKeyDraft(event.target.value);
                    setApiKeyError("");
                  }}
                />
                <button
                  className="connect-button"
                  type="submit"
                  disabled={apiKeyStatus === "Checking key…"}
                >
                  {apiKeyStatus === "Checking key…" ? "Checking…" : "Connect key"}
                </button>
              </form>
            )}
            <p className="api-key-note">
              This app keeps the key in memory only while the page is open, then sends it directly to
              RobotEvents. It is not saved in browser storage or sent to this site's server. Anyone with
              access to this page's scripts can inspect it while it is active.{" "}
              <a href="https://events.vex.com/api/v2" target="_blank" rel="noreferrer">
                Get a key from RobotEvents <ExternalLink size={11} />
              </a>
            </p>
            {apiKeyError && <p className="api-key-error" role="alert">{apiKeyError}</p>}
          </section>

          <section className="panel comparison-panel" id="team-comparison">
            <div className="panel-heading comparison-heading">
              <div>
                <span className="panel-kicker">SIDE-BY-SIDE SCOUTING</span>
                <h3>Compare teams</h3>
                <p>Compare snapshot skills or load live RobotEvents and event results.</p>
              </div>
            </div>
            <div className="comparison-selectors">
              {comparisonNumbers.map((number, index) => {
                const search = number.trim().toLowerCase();
                const hasExactTeam = standings.some((standing) => standing.teamNumber === search.toUpperCase());
                const teamSuggestions = search.length > 0 && !hasExactTeam
                  ? standings
                    .filter((standing) =>
                      !comparisonNumbers.some(
                        (selected, slot) => slot !== index && selected === standing.teamNumber,
                      ) &&
                      `${standing.teamNumber} ${standing.teamName} ${standing.organization}`
                        .toLowerCase()
                        .includes(search),
                    )
                    .slice(0, 6)
                  : [];
                return (
                  <div className="comparison-selector" key={index}>
                    <label htmlFor={`comparison-team-${index}`}>TEAM {index + 1}</label>
                    <input
                      id={`comparison-team-${index}`}
                      value={number}
                      maxLength={80}
                      placeholder="Team number or name"
                      autoComplete="off"
                      role="combobox"
                      aria-autocomplete="list"
                      aria-haspopup="listbox"
                      aria-expanded={comparisonSearchIndex === index && teamSuggestions.length > 0}
                      aria-controls={`comparison-suggestions-${index}`}
                      aria-activedescendant={
                        comparisonSearchIndex === index && suggestionActiveIndex >= 0
                          ? `comparison-suggestion-${index}-${suggestionActiveIndex}`
                          : undefined
                      }
                      onBlur={() =>
                        window.setTimeout(
                          () => setComparisonSearchIndex((current) => current === index ? null : current),
                          120,
                        )
                      }
                      onChange={(event) => {
                        setSuggestionActiveIndex(-1);
                        updateComparisonTeam(index, event.target.value);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "ArrowDown" && teamSuggestions.length > 0) {
                          event.preventDefault();
                          setSuggestionActiveIndex((current) => Math.min(current + 1, teamSuggestions.length - 1));
                        } else if (event.key === "ArrowUp" && teamSuggestions.length > 0) {
                          event.preventDefault();
                          setSuggestionActiveIndex((current) => Math.max(current - 1, 0));
                        } else if (
                          event.key === "Enter" &&
                          suggestionActiveIndex >= 0 &&
                          teamSuggestions[suggestionActiveIndex]
                        ) {
                          event.preventDefault();
                          updateComparisonTeam(index, teamSuggestions[suggestionActiveIndex].teamNumber);
                          setComparisonSearchIndex(null);
                        } else if (event.key === "Escape") {
                          setComparisonSearchIndex(null);
                        }
                      }}
                      onFocus={() => {
                        setComparisonSearchIndex(index);
                        setSuggestionActiveIndex(-1);
                      }}
                    />
                    {comparisonSearchIndex === index && teamSuggestions.length > 0 && (
                      <div
                        className="comparison-suggestions"
                        id={`comparison-suggestions-${index}`}
                        role="listbox"
                        aria-label="Matching teams"
                      >
                        {teamSuggestions.map((standing, suggestionIndex) => (
                          <button
                            key={standing.teamNumber}
                            type="button"
                            role="option"
                            id={`comparison-suggestion-${index}-${suggestionIndex}`}
                            aria-selected={suggestionIndex === suggestionActiveIndex}
                            className={suggestionIndex === suggestionActiveIndex ? "suggestion-active" : ""}
                            onMouseEnter={() => setSuggestionActiveIndex(suggestionIndex)}
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={() => {
                              updateComparisonTeam(index, standing.teamNumber);
                              setComparisonSearchIndex(null);
                            }}
                          >
                            <strong>{standing.teamNumber}</strong>
                            <span>{standing.teamName}</span>
                          </button>
                        ))}
                      </div>
                    )}
                    {comparisonNumbers.length > 2 && (
                      <button
                        className="remove-comparison-button"
                        type="button"
                        aria-label={`Remove team ${index + 1} from comparison`}
                        onClick={() => {
                          setComparisonError("");
                          setComparisonNumbers((current) => current.filter((_, slot) => slot !== index))
                        }}
                      >
                        <X size={15} />
                      </button>
                    )}
                  </div>
                );
              })}
              {comparisonNumbers.length < 4 && (
                <button
                  className="add-comparison-button"
                  type="button"
                  onClick={() => {
                    setComparisonError("");
                    setComparisonNumbers((current) => [...current, ""]);
                  }}
                >
                  <Plus size={14} /> Add team
                </button>
              )}
            </div>
            <div className="comparison-tools">
              <label>
                <span>COMPARE</span>
                <select
                  value={comparisonView}
                  onChange={(event) => setComparisonView(event.target.value as ComparisonView)}
                >
                  <option value="skills">Skills</option>
                  <option value="event">Event results</option>
                </select>
              </label>
              {comparisonView === "skills" ? (
                <label>
                  <span>DATA SOURCE</span>
                  <select
                    value={comparisonSource}
                    onChange={(event) => setComparisonSource(event.target.value as ComparisonSource)}
                  >
                    <option value="snapshot">Skills snapshot</option>
                    <option value="live">
                      RobotEvents live{loadedLiveComparisonCount === 0
                        ? " · no data"
                        : loadedLiveComparisonCount < comparisonTeams.length
                          ? " · partially loaded"
                          : " · loaded"}
                    </option>
                  </select>
                </label>
              ) : (
                <>
                  <label>
                    <span>EVENT SEARCH</span>
                    <input
                      className="comparison-tool-input"
                      value={eventSearch}
                      placeholder="Name or location"
                      onChange={(event) => setEventSearch(event.target.value)}
                    />
                  </label>
                  <label>
                    <span>EVENT</span>
                    <select
                      value={comparisonEventId}
                      onChange={(event) => setComparisonEventId(event.target.value)}
                      disabled={comparisonEvents.length === 0}
                    >
                      <option value="">{comparisonEvents.length === 0 ? "Load live teams first" : "Choose an event"}</option>
                      {comparisonEvents.map((event) => (
                        <option key={event.id} value={event.id}>{event.name}</option>
                      ))}
                    </select>
                  </label>
                </>
              )}
              <label>
                <span>CALENDAR YEAR</span>
                <select
                  value={comparisonYear}
                  onChange={(event) => setComparisonYear(event.target.value)}
                >
                  <option value="all">All years</option>
                  {comparisonYears.map((year) => <option key={year} value={year}>{year}</option>)}
                </select>
              </label>
              {comparisonSource === "live" || comparisonView === "event" ? (
                <button
                  className="add-comparison-button"
                  type="button"
                  onClick={() => void loadLiveComparison(comparisonTeams.map((team) => team.number))}
                  disabled={!apiKey || liveComparisonLoading || comparisonTeams.length < 2}
                  title={!apiKey ? "Connect a RobotEvents API key above" : "Load live data for selected teams"}
                >
                  <RefreshCw size={13} className={liveComparisonLoading ? "spin-icon" : ""} />
                  {liveComparisonLoading
                    ? "Loading live data"
                    : comparisonTeams.every((team) => Boolean(liveComparisonTeams[team.number]))
                      ? "Refresh live data"
                      : "Load live data"}
                </button>
              ) : null}
              <button className="comparison-action-button" type="button" onClick={downloadComparisonCsv}>
                <Download size={13} /> Export CSV
              </button>
              <button className="comparison-action-button" type="button" onClick={() => void copyComparisonLink()}>
                {shareCopied ? <Check size={13} /> : <ClipboardCopy size={13} />}
                {shareCopied ? "Link copied" : "Copy link"}
              </button>
            </div>
            {comparisonError && <p className="comparison-error" role="alert">{comparisonError}</p>}
            {comparisonView === "skills" && comparisonSource === "snapshot" && comparisonYear !== "all" && (
              <p className="comparison-freshness">
                Snapshot year filtering uses each team’s latest recorded skills-score year, not a full historical season archive.
              </p>
            )}
            <div className="comparison-freshness">
              {comparisonView === "event" ? (
                <span>
                  Event results use live RobotEvents data
                  {comparisonFetchedAt ? ` · Retrieved ${new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(comparisonFetchedAt))}` : ""}
                </span>
              ) : comparisonSource === "snapshot" ? (
                <span>
                  Skills snapshot · Latest score recorded {snapshotDate ? formatSnapshotDate(snapshotDate) : "date unavailable"}
                </span>
              ) : (
                <span>
                  {loadedLiveComparisonCount === 0
                    ? `RobotEvents live · No data loaded${apiKey ? " · Load live data to compare" : " · Connect an API key to load"}`
                    : `RobotEvents live · ${loadedLiveComparisonCount} of ${comparisonTeams.length} teams loaded · Retrieval times shown in the table`}
                </span>
              )}
            </div>
            {comparisonTeams.length >= 2 && comparisonView === "event" ? (
              comparisonEvents.length === 0 ? (
                <p className="comparison-empty">
                  {allComparisonEvents.length > 0
                    ? "No events match the selected year or search. Adjust the event filters."
                    : "Load live team data with a RobotEvents API key to compare event results."}
                </p>
              ) : (
                <div className="comparison-table-wrap">
                  <table className="comparison-table">
                    <thead>
                      <tr>
                        <th scope="col">EVENT RESULTS</th>
                        {comparisonTeams.map((team) => (
                          <th scope="col" key={team.number}>
                            <strong>{team.number}</strong>
                            <span>{team.name}</span>
                            <small aria-live="polite">
                              {!team.live
                                ? liveLoadStatuses[team.number] === "error"
                                  ? "Load failed"
                                  : liveLoadStatuses[team.number] === "missing"
                                    ? "Team not found"
                                    : "Not loaded"
                                : team.live.tournaments.some((event) => String(event.id) === comparisonEventId)
                                  ? "Attended"
                                  : "No event record"}
                            </small>
                            {liveLoadStatuses[team.number] === "error" && (
                              <button
                                className="inline-retry"
                                type="button"
                                disabled={liveComparisonLoading || !apiKey}
                                onClick={() => void loadLiveComparison([team.number])}
                              >
                                Retry
                              </button>
                            )}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {(["Placement", "Match record", "Match win rate", "Award"] as const).map((metric) => {
                        const events = comparisonTeams.map((team) =>
                          team.live?.tournaments.find((event) => String(event.id) === comparisonEventId) ?? null,
                        );
                        const numericValues = events.map((event) => {
                          if (!event) return null;
                          if (metric === "Placement") return Number(event.placement.match(/^#(\d+)$/)?.[1]) || null;
                          if (metric === "Match win rate") {
                            if (!event.record) return null;
                            const record = event.record.split(/[–-]/).map(Number);
                            const total = record.reduce((sum, score) => sum + score, 0);
                            return total > 0 ? (record[0] / total) * 100 : null;
                          }
                          return null;
                        });
                        const validValues = numericValues.filter((value): value is number => value !== null);
                        const maxValue = validValues.length > 0 ? Math.max(...validValues) : 0;
                        const minValue = validValues.length > 0 ? Math.min(...validValues) : 0;
                        const bestValue = validValues.length > 1
                          ? metric === "Placement" ? Math.min(...validValues) : Math.max(...validValues)
                          : null;
                        return (
                          <tr key={metric}>
                            <th scope="row">{metric}</th>
                            {comparisonTeams.map((team, index) => {
                              const event = events[index];
                              const value = numericValues[index];
                              const display = metric === "Placement"
                                ? event ? event.placement === "—" ? "No placement" : event.placement : "No event data"
                                : metric === "Match record"
                                  ? event ? event.record ?? "No scored matches" : "Did not attend"
                                  : metric === "Match win rate"
                                    ? value === null ? event ? "No scored matches" : "Did not attend" : `${value.toFixed(1)}%`
                                    : event ? event.award ?? "—" : "No event data";
                              const isBest = bestValue !== null && value === bestValue;
                              return (
                                <td className={isBest ? "best-comparison" : ""} key={team.number}>
                                  {display}{isBest && <span className="best-label">Best</span>}
                                  {value !== null && (
                                    <span className="comparison-bar" aria-hidden="true">
                                      <span
                                        style={{
                                          width: `${
                                            metric === "Placement"
                                              ? value > 0 ? (minValue / value) * 100 : 0
                                              : maxValue > 0 ? (value / maxValue) * 100 : 0
                                          }%`,
                                        }}
                                      />
                                    </span>
                                  )}
                                </td>
                              );
                            })}
                          </tr>
                        );
                      })}
                      <tr>
                        <th scope="row">Data coverage</th>
                        {comparisonTeams.map((team) => {
                          const event = team.live?.tournaments.find((item) => String(item.id) === comparisonEventId);
                          return (
                            <td key={team.number}>
                              {!team.live
                                ? liveLoadStatuses[team.number] === "error"
                                  ? "Request failed"
                                  : liveLoadStatuses[team.number] === "missing" ? "Team not found" : "Not loaded"
                                : !event
                                  ? "No event record returned"
                                    : `${event.matches.length} scored matches · ${event.programmingSkillsRuns} programming / ${event.driverSkillsRuns} driver runs`}
                            </td>
                          );
                        })}
                      </tr>
                      {comparisonEventMatches.map((match) => (
                        <tr key={`match-${match.id}`}>
                          <th scope="row">{match.name}</th>
                          {comparisonTeams.map((team) => {
                            const result = team.live?.tournaments
                              .find((event) => String(event.id) === comparisonEventId)
                              ?.matches.find((item) => item.id === match.id);
                            const attended = team.live?.tournaments
                              .some((event) => String(event.id) === comparisonEventId) ?? false;
                            return (
                              <td key={team.number}>
                                {result
                                  ? `${result.result} · ${result.teamScore}–${result.opponentScore}`
                                  : attended ? "No score returned" : "Did not attend"}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
            ) : comparisonTeams.length >= 2 ? (
              <div className="comparison-table-wrap">
                <table className="comparison-table">
                  <thead>
                    <tr>
                      <th scope="col">
                        {comparisonSource === "snapshot"
                          ? "SKILLS SNAPSHOT"
                          : `ROBOTEVENTS LIVE${loadedLiveComparisonCount === 0 ? " · NO DATA" : ""}`}
                      </th>
                      {comparisonTeams.map((team) => (
                        <th scope="col" key={team.number}>
                          <strong>{team.number}</strong>
                          <span>{team.name}</span>
                          {comparisonSource === "live" && (
                            <>
                              <small
                                className={`team-load-status ${liveLoadStatuses[team.number] ?? (team.live ? "loaded" : "")}`}
                                aria-live="polite"
                              >
                                {liveLoadStatuses[team.number] === "loading"
                                  ? "Loading…"
                                  : liveLoadStatuses[team.number] === "error"
                                    ? team.live ? "Refresh failed · cached data shown" : "Load failed"
                                    : liveLoadStatuses[team.number] === "missing"
                                      ? "Team not found"
                                      : team.live
                                        ? `Updated ${new Intl.DateTimeFormat(undefined, { dateStyle: "short", timeStyle: "short" }).format(new Date(team.live.fetchedAt))}`
                                        : "Not loaded"}
                              </small>
                              {liveLoadStatuses[team.number] === "error" && (
                                <button
                                  className="inline-retry"
                                  type="button"
                                  disabled={liveComparisonLoading || !apiKey}
                                  onClick={() => void loadLiveComparison([team.number])}
                                >
                                  Retry
                                </button>
                              )}
                            </>
                          )}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {comparisonMetrics.map((metric) => {
                      const values = comparisonTeams.map(metric.getValue);
                      const validValues = values.filter((value): value is number => value !== null);
                      const maxValue = validValues.length > 0 ? Math.max(...validValues) : 0;
                      const minValue = validValues.length > 0 ? Math.min(...validValues) : 0;
                      const bestValue = validValues.length > 1
                        ? metric.higherIsBetter ? Math.max(...validValues) : Math.min(...validValues)
                        : null;
                      return (
                        <tr key={metric.label}>
                          <th scope="row">{metric.label}</th>
                          {comparisonTeams.map((team, index) => {
                            const value = values[index];
                            const available = comparisonSource === "snapshot" ? team.snapshot : team.live;
                            const isBest = bestValue !== null && value === bestValue;
                            return (
                              <td className={isBest ? "best-comparison" : ""} key={team.number}>
                                {value === null
                                  ? comparisonSource === "snapshot"
                                    ? comparisonYear !== "all" && team.snapshot
                                      ? `No score in ${comparisonYear}`
                                      : "Not in snapshot"
                                    : liveLoadStatuses[team.number] === "error"
                                      ? (
                                        <>
                                          Load failed{" "}
                                          <button
                                            className="inline-retry"
                                            type="button"
                                            disabled={liveComparisonLoading || !apiKey}
                                            onClick={() => void loadLiveComparison([team.number])}
                                          >
                                            Retry
                                          </button>
                                        </>
                                      )
                                      : liveLoadStatuses[team.number] === "missing"
                                        ? "Team not found"
                                      : available ? "Not available" : "Load live data"
                                  : metric.format(value)}
                                {isBest && <span className="best-label">Best</span>}
                                {value !== null && (
                                  <span className="comparison-bar" aria-hidden="true">
                                    <span
                                      style={{
                                        width: `${
                                          metric.higherIsBetter
                                            ? maxValue > 0 ? (value / maxValue) * 100 : 0
                                            : value > 0 ? (minValue / value) * 100 : 0
                                        }%`,
                                      }}
                                    />
                                  </span>
                                )}
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                    <tr>
                      <th scope="row">Data coverage</th>
                      {comparisonTeams.map((team) => (
                        <td key={team.number}>
                          {comparisonSource === "snapshot"
                            ? !team.snapshot
                              ? "No snapshot data"
                              : comparisonYear !== "all" && team.snapshot.latestScoreAt.slice(0, 4) !== comparisonYear
                                ? `No score in ${comparisonYear}`
                                : `Rank and scores available · Latest score ${team.snapshot.latestScoreAt.slice(0, 10)}`
                            : !team.live
                              ? liveLoadStatuses[team.number] === "error"
                                ? "Request failed"
                                : liveLoadStatuses[team.number] === "missing" ? "Team not found" : "Not loaded"
                              : formatLiveCoverage(team, comparisonYear)}
                        </td>
                      ))}
                    </tr>
                    <tr>
                      <th scope="row">Location</th>
                      {comparisonTeams.map((team) => (
                        <td key={team.number}>
                          {comparisonSource === "snapshot"
                            ? team.snapshot && (comparisonYear === "all" || team.snapshot.latestScoreAt.slice(0, 4) === comparisonYear)
                              ? [team.snapshot.region, team.snapshot.country].filter(Boolean).join(", ") || "—"
                              : team.snapshot ? `No score in ${comparisonYear}` : "Not in snapshot"
                            : team.live?.location || (team.live ? "Not available" : "Load live data")}
                        </td>
                      ))}
                    </tr>
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="comparison-empty">
                {comparisonTeams.length === 1
                  ? "Add another team to see a side-by-side comparison."
                  : loading
                    ? "Loading teams from the skills snapshot…"
                    : "Enter at least two team numbers. Choose from suggestions or enter teams not in the snapshot."}
              </p>
            )}
            <section className="scout-notes-section" aria-label="Private scouting notes">
              <div className="scout-notes-heading">
                <div>
                  <span className="panel-kicker">LOCAL SCOUTING</span>
                  <h4>Team notes</h4>
                </div>
                <span>Saved in this browser only</span>
              </div>
              {comparisonTeams.length === 0 ? (
                <p className="comparison-empty">Add teams above to record scouting notes.</p>
              ) : (
                <div className="scout-notes-grid">
                  {comparisonTeams.map((team) => {
                    const notes = scoutNotes[team.number] ?? { notes: "", tags: [] };
                    return (
                      <article className="scout-notes-card" key={team.number}>
                        <h5>{team.number} · {team.name}</h5>
                        <div className="scout-tags" aria-label={`${team.number} scouting tags`}>
                          {scoutTags.map((tag) => (
                            <button
                              className={notes.tags.includes(tag) ? "scout-tag selected" : "scout-tag"}
                              type="button"
                              key={tag}
                              aria-pressed={notes.tags.includes(tag)}
                              onClick={() => toggleScoutTag(team.number, tag)}
                            >
                              {tag}
                            </button>
                          ))}
                        </div>
                        <label className="sr-only" htmlFor={`scout-notes-${team.number}`}>
                          Scouting notes for team {team.number}
                        </label>
                        <textarea
                          id={`scout-notes-${team.number}`}
                          value={notes.notes}
                          maxLength={1000}
                          placeholder="Strengths, reliability, strategy, or match observations…"
                          onChange={(event) => updateScoutNotes(team.number, { notes: event.target.value })}
                        />
                      </article>
                    );
                  })}
                </div>
              )}
              {scoutNotesError && <p className="comparison-error" role="alert">{scoutNotesError}</p>}
            </section>
            <p className="comparison-footnote">
              Calendar-year filters use event dates. Snapshot year filters use each team’s latest recorded score year; the snapshot is not a historical archive. Bars and “Best” labels supplement the numeric values. Equal leaders are all highlighted.
            </p>
          </section>

          {(notice || loadError) && (
            <div className="notice" role="status">
              <span>{loadError || notice}</span>
              {!team && !loadError && (
                <button type="button" onClick={showExample}>
                  View example team <ArrowRight size={14} />
                </button>
              )}
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
                <span>
                  <strong>RobotEvents live lookup</strong> — details fetched using your API key.
                </span>
                <span className="snapshot-date">
                  Retrieved {new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(liveTeam.fetchedAt))}
                </span>
              </div>

              <section className="team-card">
                <div className="team-identity">
                  <div className="team-avatar">
                    <span>{liveTeam.number.slice(0, 2)}</span>
                    <small>{liveTeam.number.slice(2)}</small>
                  </div>
                  <div className="team-info">
                    <div className="team-number">TEAM {liveTeam.number}</div>
                    <h2>{liveTeam.name}</h2>
                    <div className="team-meta">
                      {liveTeam.organization && (
                        <span>
                          <Users size={14} /> {liveTeam.organization}
                        </span>
                      )}
                      {liveTeam.location && (
                        <span>
                          <MapPin size={14} /> {liveTeam.location}
                        </span>
                      )}
                      {liveTeam.grade && <span>{liveTeam.grade}</span>}
                    </div>
                  </div>
                </div>
                <div className="team-card-right">
                  <span className="division-label">VEX V5 ROBOTICS</span>
                  <span className="active-season-tag">
                    <span /> Live API
                  </span>
                </div>
              </section>

              <section className="stat-grid" aria-label="Live team summary">
                <article className="stat-card">
                  <div className="stat-top">
                    <span>Events attended</span>
                    <span className="stat-icon mint-icon">
                      <MapPin size={16} />
                    </span>
                  </div>
                  <div className="stat-value">{liveTeam.events}</div>
                  <div className="stat-foot">
                    <span className="stat-note">All events returned by API</span>
                  </div>
                </article>
                <article className="stat-card">
                  <div className="stat-top">
                    <span>Match record</span>
                    <span className="stat-icon gold-icon">
                      <AwardIcon size={16} />
                    </span>
                  </div>
                  <div className={liveTeam.coverage.scoredMatches > 0 ? "stat-value" : "stat-value stat-value-label"}>
                    {liveTeam.coverage.scoredMatches > 0
                      ? `${liveTeam.wins}–${liveTeam.losses}–${liveTeam.ties}`
                      : "No scored matches"}
                  </div>
                  <div className="stat-foot">
                    <span className="stat-note">From scored matches</span>
                  </div>
                </article>
                <article className="stat-card skills-stat">
                  <div className="stat-top">
                    <span>Best skills score</span>
                    <span className="stat-icon blue-icon">
                      <AwardIcon size={16} />
                    </span>
                  </div>
                  <div className={
                    liveTeam.coverage.programmingRuns > 0 && liveTeam.coverage.driverRuns > 0
                      ? "stat-value"
                      : "stat-value stat-value-label"
                  }>
                    {liveTeam.coverage.programmingRuns > 0 && liveTeam.coverage.driverRuns > 0
                      ? liveTeam.skills.combined
                      : "Not available"}
                  </div>
                  <div className="stat-foot">
                    <span className="stat-note">Best programming + driver</span>
                  </div>
                </article>
              </section>
              <p className="coverage-strip">
                Data coverage: {liveTeam.coverage.events} events · {liveTeam.coverage.programmingRuns} programming and{" "}
                {liveTeam.coverage.driverRuns} driver skills runs · {liveTeam.coverage.scoredMatches} scored matches
                across {liveTeam.coverage.eventsWithScoredMatches} events.
                {liveTeam.coverage.programmingRuns === 0 || liveTeam.coverage.driverRuns === 0
                  ? " Some skills categories have no returned runs."
                  : ""}
              </p>

              <div className="content-grid">
                <section className="panel awards-panel">
                  <div className="panel-heading">
                    <div>
                      <span className="panel-kicker">RECOGNITION</span>
                      <h3>
                        Team awards <span className="count-badge">{liveTeam.awards.length}</span>
                      </h3>
                    </div>
                  </div>
                  <div className="award-list">
                    {liveTeam.awards.slice(0, 5).map((award) => (
                      <article className="award-row" key={`${award.name}-${award.event}-${award.date}`}>
                        <div className="award-mark mint">
                          <AwardIcon size={18} />
                        </div>
                        <div className="award-copy">
                          <strong>{award.name}</strong>
                          <span>{award.event}</span>
                        </div>
                        <time>{award.date}</time>
                      </article>
                    ))}
                    {liveTeam.awards.length === 0 && (
                      <p className="panel-empty">No awards were returned for this team.</p>
                    )}
                  </div>
                </section>

                <section className="panel skills-panel">
                  <div className="panel-heading">
                    <div>
                      <span className="panel-kicker">ROBOT SKILLS</span>
                      <h3>Best recorded scores</h3>
                    </div>
                  </div>
                  <div className="skills-total">
                    <strong>
                      {liveTeam.coverage.programmingRuns > 0 && liveTeam.coverage.driverRuns > 0
                        ? liveTeam.skills.combined
                        : "—"}
                    </strong>
                    <span>best programming + driver</span>
                    {liveTeam.skillsRank !== null && (
                      <span className="best-score">Best run rank #{liveTeam.skillsRank}</span>
                    )}
                  </div>
                  <div className="skills-bars">
                    <SkillBar
                      label={liveTeam.coverage.programmingRuns > 0 ? "Programming" : "Programming (no runs)"}
                      value={liveTeam.skills.programming}
                      max={liveTeam.skills.combined || 1}
                      color="violet-fill"
                      scaleLabel="combined score"
                    />
                    <SkillBar
                      label={liveTeam.coverage.driverRuns > 0 ? "Driver" : "Driver (no runs)"}
                      value={liveTeam.skills.driver}
                      max={liveTeam.skills.combined || 1}
                      color="green-fill"
                      scaleLabel="combined score"
                    />
                  </div>
                  <div className="skills-footer">
                    <span>
                      <span className="legend-dot violet-dot" /> Programming
                    </span>
                    <span>
                      <span className="legend-dot green-dot" /> Driver skills
                    </span>
                  </div>
                </section>
              </div>

              <section className="panel tournaments-panel" id="tournaments">
                <div className="panel-heading tournament-heading">
                  <div>
                    <span className="panel-kicker">COMPETITION HISTORY</span>
                    <h3>
                      Events and placements{" "}
                      <span className="count-badge">{filteredTeamEvents.length}</span>
                    </h3>
                  </div>
                </div>
                <div className="event-filters">
                  <label>
                    <span>YEAR</span>
                    <select value={eventYearFilter} onChange={(event) => setEventYearFilter(event.target.value)}>
                      <option value="all">All years</option>
                      {eventYears.map((year) => <option key={year} value={year}>{year}</option>)}
                    </select>
                  </label>
                  <label>
                    <span>EVENT OR REGION</span>
                    <input
                      value={eventLocationFilter}
                      placeholder="Filter by event or location"
                      onChange={(event) => setEventLocationFilter(event.target.value)}
                    />
                  </label>
                </div>
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>EVENT</th>
                        <th>DATE</th>
                        <th>PLACEMENT</th>
                        <th>RECORD</th>
                        <th>HIGHLIGHT</th>
                        <th aria-label="Details" />
                      </tr>
                    </thead>
                    <tbody>
                      {filteredTeamEvents.slice(0, 10).map((event) => (
                        <tr key={event.id}>
                          <td>
                            <div className="event-name">{event.name}</div>
                            <div className="event-location">
                              <MapPin size={12} /> {event.location}
                            </div>
                          </td>
                          <td className="date-cell">{event.date}</td>
                          <td>
                            <span className="placement">{event.placement}</span>
                          </td>
                          <td>
                            {event.record
                              ? <span className="record">{event.record}</span>
                              : <span className="no-highlight">No scored matches</span>}
                          </td>
                          <td>
                            {event.award ? (
                              <span className="highlight-tag">{event.award}</span>
                            ) : (
                              <span className="no-highlight">—</span>
                            )}
                          </td>
                          <td>
                            <a
                              className="row-arrow"
                              aria-label={`View ${event.name} on RobotEvents`}
                              href={`https://events.vex.com/events/${event.id}`}
                              target="_blank"
                              rel="noreferrer"
                            >
                              <ExternalLink size={14} />
                            </a>
                          </td>
                        </tr>
                      ))}
                      {filteredTeamEvents.length === 0 && (
                        <tr>
                          <td colSpan={6}>
                            {liveTeam.tournaments.length === 0
                              ? "No event history was returned for this team."
                              : "No events match these filters."}
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
                <div className="table-footer">
                  <span>
                    Showing {Math.min(filteredTeamEvents.length, 10)} of {filteredTeamEvents.length} filtered events
                  </span>
                  <span>Records are calculated from scored matches.</span>
                </div>
              </section>

              <footer className="page-footer">
                <span>
                  SCOUTLINE <span className="footer-dot">•</span> VEX V5 TEAM INTELLIGENCE
                </span>
                <span>Live data provided by RobotEvents API.</span>
              </footer>
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
              <p>
                {apiKeyError ||
                  notice ||
                  `${selectedNumber} was not found. Enter another team number to search live records.`}
              </p>
            </section>
          ) : loadError ? (
            <section className="empty-state" role="alert">
              <div className="empty-icon"><Search size={23} /></div>
              <h2>Standings unavailable</h2>
              <p>
                Check that <code>skills-standings.csv</code> is present in the deployed site, then try again.
              </p>
            </section>
          ) : team ? (
            <>
              <div className="snapshot-banner">
                <span className="snapshot-dot" />
                <span>
                  <strong>Skills standings snapshot</strong> — imported from the CSV supplied for this app.
                </span>
                <span className="snapshot-date">Latest recorded score: {formatSnapshotDate(snapshotDate)}</span>
              </div>

              <section className="team-card">
                <div className="team-identity">
                  <div className="team-avatar">
                    <span>{team.teamNumber.slice(0, 2)}</span>
                    <small>{team.teamNumber.slice(2)}</small>
                  </div>
                  <div className="team-info">
                    <div className="team-number">TEAM {team.teamNumber}</div>
                    <h2>{team.teamName}</h2>
                    <div className="team-meta">
                      {team.organization && (
                        <span>
                          <Users size={14} /> {team.organization}
                        </span>
                      )}
                      {[team.region, team.country].filter(Boolean).length > 0 && (
                        <span>
                          <MapPin size={14} />{" "}
                          {[team.region, team.country].filter(Boolean).join(", ")}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="team-card-right">
                  <span className="division-label">VEX V5 ROBOTICS</span>
                  <span className="active-season-tag">
                    <span /> In supplied standings
                  </span>
                </div>
              </section>

              <section className="stat-grid" aria-label="Team skills standings summary">
                <article className="stat-card">
                  <div className="stat-top">
                    <span>Skills rank</span>
                    <span className="stat-icon mint-icon">
                      <AwardIcon size={16} />
                    </span>
                  </div>
                  <div className="stat-value">#{team.rank}</div>
                  <div className="stat-foot">
                    <span className="stat-note">Rank in this CSV snapshot</span>
                  </div>
                </article>
                <article className="stat-card">
                  <div className="stat-top">
                    <span>Combined skills score</span>
                    <span className="stat-icon gold-icon">
                      <AwardIcon size={16} />
                    </span>
                  </div>
                  <div className="stat-value">
                    {team.score}
                    <span className="stat-unit"> points</span>
                  </div>
                  <div className="stat-foot">
                    <span className="stat-note">Autonomous + driver skills</span>
                  </div>
                </article>
                <article className="stat-card skills-stat">
                  <div className="stat-top">
                    <span>Teams in snapshot</span>
                    <span className="stat-icon blue-icon">
                      <Users size={16} />
                    </span>
                  </div>
                  <div className="stat-value">{standings.length.toLocaleString()}</div>
                  <div className="stat-foot">
                    <span className="stat-note">Rows in supplied CSV</span>
                  </div>
                </article>
              </section>

              <div className="content-grid">
                <section className="panel skills-panel">
                  <div className="panel-heading">
                    <div>
                      <span className="panel-kicker">ROBOT SKILLS</span>
                      <h3>Best skills scores</h3>
                    </div>
                  </div>
                  <div className="skills-total">
                    <strong>{team.score}</strong>
                    <span>combined score</span>
                  </div>
                  <div className="skills-bars">
                    <SkillBar
                      label="Best autonomous coding"
                      value={team.highestProgramming}
                      max={highestProgramming}
                      color="violet-fill"
                    />
                    <SkillBar
                      label="Best driver skills"
                      value={team.highestDriver}
                      max={highestDriver}
                      color="green-fill"
                    />
                  </div>
                  <div className="skills-footer">
                    <span>
                      <span className="legend-dot violet-dot" /> Autonomous coding
                    </span>
                    <span>
                      <span className="legend-dot green-dot" /> Driver skills
                    </span>
                  </div>
                </section>

                <section className="panel data-limits-panel">
                  <div className="panel-heading">
                    <div>
                      <span className="panel-kicker">DATA INCLUDED</span>
                      <h3>Snapshot view</h3>
                    </div>
                  </div>
                  <p>
                    This CSV includes team names, locations, ranks, and skills scores. It does not
                    include awards, event placements, participation history, or match records.
                    Connect RobotEvents for the full competition picture.
                  </p>
                  <a
                    className="text-link"
                    href={`https://events.vex.com/teams/V5RC/${encodeURIComponent(team.teamNumber)}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Open VEX team page <ExternalLink size={14} />
                  </a>
                </section>
              </div>

              <section className="panel tournaments-panel source-panel">
                <div className="panel-heading">
                  <div>
                    <span className="panel-kicker">SOURCE</span>
                    <h3>Supplied skills standings CSV</h3>
                  </div>
                  <a
                    className="text-link"
                    href={`${import.meta.env.BASE_URL}skills-standings.csv`}
                    download
                  >
                    Download file <ArrowRight size={14} />
                  </a>
                </div>
                <div className="source-details">
                  <span>{standings.length.toLocaleString()} teams in this snapshot</span>
                  <span>Latest recorded score: {formatSnapshotDate(snapshotDate)}</span>
                </div>
              </section>

              <footer className="page-footer">
                <span>
                  SCOUTLINE <span className="footer-dot">•</span> VEX V5 TEAM INTELLIGENCE
                </span>
                <span>Scores reflect the supplied CSV snapshot, not a live feed.</span>
              </footer>
            </>
          ) : (
            <section className="empty-state">
              <div className="empty-icon"><Search size={23} /></div>
              <h2>Team not in this snapshot</h2>
              <p>
                {notice ||
                  `${selectedNumber} is not listed in the supplied skills standings file. Try another team number.`}
              </p>
              <button className="search-button" onClick={showExample}>
                View example team <ArrowRight size={16} />
              </button>
            </section>
          )}
        </div>
      </main>
    </div>
  );
}

export default App;
