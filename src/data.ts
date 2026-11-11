export interface SkillsStanding {
  rank: number;
  score: number;
  programming: number;
  driver: number;
  highestProgramming: number;
  highestDriver: number;
  latestScoreAt: string;
  teamNumber: string;
  teamName: string;
  organization: string;
  region: string;
  country: string;
}

interface SkillsStandingsData {
  rows: SkillsStanding[];
  latestScoreAt: string;
}

function parseCsvRows(csv: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < csv.length; index += 1) {
    const character = csv[index];
    if (quoted) {
      if (character === '"' && csv[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
    } else if (character === '"' && field.length === 0) {
      quoted = true;
    } else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n" || character === "\r") {
      if (character === "\r" && csv[index + 1] === "\n") index += 1;
      row.push(field);
      if (row.some((cell) => cell.trim() !== "")) rows.push(row);
      row = [];
      field = "";
    } else {
      field += character;
    }
  }

  if (quoted) throw new Error("The standings CSV contains an unterminated quoted field.");
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    if (row.some((cell) => cell.trim() !== "")) rows.push(row);
  }
  return rows;
}

function numericValue(record: Record<string, string>, field: string, rowNumber: number): number {
  const value = Number(record[field]);
  if (!Number.isFinite(value)) {
    throw new Error(`The standings CSV has an invalid ${field} value on row ${rowNumber}.`);
  }
  return value;
}

export function parseSkillsStandings(csv: string): SkillsStandingsData {
  const [headerRow, ...dataRows] = parseCsvRows(csv);
  if (!headerRow || dataRows.length === 0) {
    throw new Error("The skills standings CSV is empty.");
  }

  const headers = headerRow.map((header, index) =>
    (index === 0 ? header.replace(/^\uFEFF/, "") : header).trim(),
  );
  const requiredFields = [
    "Rank",
    "Score",
    "Autonomous Coding Skills",
    "Driver Skills",
    "Highest Autonomous Coding Skills",
    "Highest Driver Skills",
    "Highest Autonomous Score Timestamp",
    "Highest Driver Score Timestamp",
    "Team Number",
    "Team Name",
    "Organization",
    "Event Region",
    "Country / Region",
  ];
  const missingFields = requiredFields.filter((field) => !headers.includes(field));
  if (missingFields.length > 0) {
    throw new Error(`The skills standings CSV is missing columns: ${missingFields.join(", ")}.`);
  }

  const seenTeams = new Set<string>();
  const timestamps: string[] = [];
  const rows = dataRows.map((values, index): SkillsStanding => {
    const record = Object.fromEntries(
      headers.map((header, column) => [header, values[column] ?? ""]),
    );
    const rowNumber = index + 2;
    const teamNumber = record["Team Number"].trim().toUpperCase();
    if (!teamNumber || seenTeams.has(teamNumber)) {
      throw new Error(`The skills standings CSV has a missing or duplicate team number on row ${rowNumber}.`);
    }
    seenTeams.add(teamNumber);

    const scoreTimestamps = [
      record["Highest Autonomous Score Timestamp"],
      record["Highest Driver Score Timestamp"],
    ].filter(Boolean);
    timestamps.push(...scoreTimestamps);

    return {
      rank: numericValue(record, "Rank", rowNumber),
      score: numericValue(record, "Score", rowNumber),
      programming: numericValue(record, "Autonomous Coding Skills", rowNumber),
      driver: numericValue(record, "Driver Skills", rowNumber),
      highestProgramming: numericValue(record, "Highest Autonomous Coding Skills", rowNumber),
      highestDriver: numericValue(record, "Highest Driver Skills", rowNumber),
      latestScoreAt: scoreTimestamps.sort()[scoreTimestamps.length - 1] ?? "",
      teamNumber,
      teamName: record["Team Name"].trim(),
      organization: record.Organization.trim(),
      region: record["Event Region"].trim(),
      country: record["Country / Region"].trim(),
    };
  });

  const sortedTimestamps = timestamps.sort();
  const latestScoreAt = sortedTimestamps[sortedTimestamps.length - 1];
  if (!latestScoreAt) {
    throw new Error("The skills standings CSV does not contain any score timestamps.");
  }
  return { rows, latestScoreAt };
}
