#!/usr/bin/env python3
"""Refresh Scoutline's V5RC skills snapshot through the authenticated VEX API."""

from __future__ import annotations

import csv
import json
import math
import os
import sys
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen


API_BASE = "https://events.vex.com/api/v2"
V5RC_PROGRAM_ID = 1
PAGE_SIZE = 250
MAX_PAGES = 20
TEAM_BATCH_SIZE = 100
MAX_ATTEMPTS = 5
REQUEST_TIMEOUT_SECONDS = 30
REQUEST_INTERVAL_SECONDS = float(os.environ.get("VEX_EVENTS_REQUEST_INTERVAL", "1"))
MINIMUM_TEAM_COUNT = 100
PREVIOUS_SNAPSHOT_MINIMUM_RATIO = 0.10
OUTPUT_PATH = Path(__file__).resolve().parents[1] / "public" / "skills-standings.csv"

CSV_FIELDS = (
    "Rank",
    "Score",
    "Autonomous Coding Skills",
    "Driver Skills",
    "Highest Autonomous Coding Skills",
    "Highest Driver Skills",
    "Highest Autonomous Score Timestamp",
    "Highest Driver Score Timestamp",
    "Highest Autonomous Score Stop Time",
    "Highest Driver Score Stop Time",
    "Team Number",
    "Team Name",
    "Organization",
    "Event Region",
    "Country / Region",
)


class APIError(RuntimeError):
    def __init__(self, message: str, status_code: int | None = None):
        super().__init__(message)
        self.status_code = status_code


def api_get(path: str, params: list[tuple[str, str]], token: str) -> dict[str, Any]:
    query = urlencode(params)
    url = f"{API_BASE}/{path.lstrip('/')}"
    if query:
        url = f"{url}?{query}"

    for attempt in range(MAX_ATTEMPTS):
        request = Request(
            url,
            headers={
                "Accept": "application/json",
                "Authorization": f"Bearer {token}",
                "User-Agent": "Scoutline-skills-snapshot/1.0",
            },
        )
        try:
            with urlopen(request, timeout=REQUEST_TIMEOUT_SECONDS) as response:
                payload = json.loads(response.read())
            if not isinstance(payload, dict) or not isinstance(payload.get("data"), list):
                raise APIError(f"VEXEvents returned an invalid response for {path}.")
            if REQUEST_INTERVAL_SECONDS > 0:
                time.sleep(REQUEST_INTERVAL_SECONDS)
            return payload
        except HTTPError as error:
            if error.code == 404:
                raise APIError(f"VEXEvents returned HTTP 404 for {path}.", error.code) from error
            if error.code != 429 and error.code < 500:
                raise APIError(
                    f"VEXEvents returned HTTP {error.code} for {path}; check the API token and permissions.",
                    error.code,
                ) from error
            retry_after = error.headers.get("Retry-After", "")
            delay = min(int(retry_after), 60) if retry_after.isdigit() else min(2**attempt, 30)
            if attempt == MAX_ATTEMPTS - 1:
                raise APIError(
                    f"VEXEvents remained unavailable for {path} after {MAX_ATTEMPTS} attempts.",
                    error.code,
                ) from error
            print(f"VEXEvents HTTP {error.code} for {path}; retrying in {delay}s.", file=sys.stderr)
            time.sleep(delay)
        except (URLError, TimeoutError, json.JSONDecodeError) as error:
            if attempt == MAX_ATTEMPTS - 1:
                raise APIError(
                    f"Could not retrieve a valid VEXEvents response for {path} after {MAX_ATTEMPTS} attempts."
                ) from error
            delay = min(2**attempt, 30)
            print(f"VEXEvents request failed for {path}; retrying in {delay}s.", file=sys.stderr)
            time.sleep(delay)

    raise APIError(f"Could not retrieve VEXEvents data for {path}.")


def get_all_pages(path: str, params: list[tuple[str, str]], token: str) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    for page in range(1, MAX_PAGES + 1):
        payload = api_get(path, [*params, ("per_page", str(PAGE_SIZE)), ("page", str(page))], token)
        records.extend(record for record in payload["data"] if isinstance(record, dict))
        meta = payload.get("meta") or {}
        try:
            last_page = int(meta.get("last_page") or 1)
        except (TypeError, ValueError) as error:
            raise APIError(f"VEXEvents returned invalid pagination metadata for {path}.") from error
        if last_page < 1:
            raise APIError(f"VEXEvents returned invalid pagination metadata for {path}.")
        if page >= last_page:
            return records
    raise APIError(f"VEXEvents exceeded the {MAX_PAGES}-page safety limit for {path}.")


def parse_api_datetime(value: Any) -> datetime | None:
    if not isinstance(value, str) or not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed.replace(tzinfo=timezone.utc) if parsed.tzinfo is None else parsed


def current_v5_season_id(token: str, now: datetime | None = None) -> int:
    current_time = now or datetime.now(timezone.utc)
    seasons = get_all_pages("seasons", [("program[]", str(V5RC_PROGRAM_ID))], token)
    active: list[tuple[datetime, dict[str, Any]]] = []
    for season in seasons:
        if int((season.get("program") or {}).get("id", -1)) != V5RC_PROGRAM_ID:
            continue
        start = parse_api_datetime(season.get("start"))
        end = parse_api_datetime(season.get("end"))
        if start and end and start <= current_time <= end and season.get("id") is not None:
            active.append((start, season))
    if not active:
        raise APIError(
            "VEXEvents did not return an active V5RC season; refusing to guess which season to publish."
        )
    latest_start = max(start for start, _ in active)
    latest = [season for start, season in active if start == latest_start]
    if len(latest) != 1:
        raise APIError("VEXEvents returned ambiguous active V5RC seasons; refusing to guess which one to publish.")
    return int(latest[0]["id"])


def completed_v5_events(
    events: list[dict[str, Any]],
    season_id: int,
    now: datetime | None = None,
) -> list[dict[str, Any]]:
    current_time = now or datetime.now(timezone.utc)
    completed: list[dict[str, Any]] = []
    for event in events:
        if int((event.get("program") or {}).get("id", -1)) != V5RC_PROGRAM_ID:
            continue
        if int((event.get("season") or {}).get("id", -1)) != season_id:
            continue
        end_time = parse_api_datetime(event.get("end"))
        if not end_time:
            continue
        if end_time <= current_time:
            completed.append(event)
    return completed


def read_previous_snapshot(path: Path) -> dict[str, dict[str, str]]:
    if not path.exists():
        return {}
    with path.open(encoding="utf-8-sig", newline="") as snapshot:
        reader = csv.DictReader(snapshot)
        if tuple(reader.fieldnames or ()) != CSV_FIELDS:
            raise APIError("The existing skills snapshot has an unexpected CSV header; refusing to replace it.")
        previous: dict[str, dict[str, str]] = {}
        for row in reader:
            number = (row.get("Team Number") or "").strip().upper()
            if not number or number in previous:
                raise APIError("The existing skills snapshot has missing or duplicate team numbers.")
            previous[number] = row
        return previous


def format_score_timestamp(skill: dict[str, Any], event: dict[str, Any]) -> str:
    value = next(
        (
            skill.get(field)
            for field in ("created_at", "recorded_at", "scored_at", "timestamp")
            if isinstance(skill.get(field), str) and skill[field].strip()
        ),
        None,
    )
    if not value:
        value = event.get("end") or event.get("start")
    if not isinstance(value, str):
        raise APIError("A skills result has no timestamp or associated event date.")
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as error:
        raise APIError("VEXEvents returned an invalid skills timestamp or event date.") from error
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")


def collect_team_ids(skill_runs: list[tuple[dict[str, Any], dict[str, Any]]]) -> list[str]:
    team_ids = {
        str(team["id"])
        for _, skill in skill_runs
        if isinstance((team := skill.get("team")), dict) and team.get("id") is not None
    }
    return sorted(team_ids)


def fetch_team_details(team_ids: list[str], token: str) -> dict[str, dict[str, Any]]:
    details: dict[str, dict[str, Any]] = {}
    for start in range(0, len(team_ids), TEAM_BATCH_SIZE):
        batch = team_ids[start : start + TEAM_BATCH_SIZE]
        params = [("id[]", team_id) for team_id in batch]
        for team in get_all_pages("teams", params, token):
            if team.get("id") is not None:
                details[str(team["id"])] = team
    return details


def build_snapshot_rows(
    skill_runs: list[tuple[dict[str, Any], dict[str, Any]]],
    team_details: dict[str, dict[str, Any]],
    previous: dict[str, dict[str, str]],
) -> list[dict[str, Any]]:
    aggregates: dict[str, dict[str, Any]] = {}
    for event, skill in skill_runs:
        skill_type = skill.get("type")
        if skill_type not in {"programming", "driver"}:
            continue
        team = skill.get("team")
        if not isinstance(team, dict):
            raise APIError("VEXEvents returned a skills result without team information.")
        team_id = str(team["id"]) if team.get("id") is not None else ""
        team_info = team_details.get(team_id, {})
        number = str(team_info.get("number") or team.get("number") or team.get("name") or "").strip().upper()
        if not number:
            raise APIError("VEXEvents returned a skills result without a team number.")
        try:
            score = int(skill["score"])
        except (KeyError, TypeError, ValueError) as error:
            raise APIError(f"VEXEvents returned an invalid skills score for {number}.") from error
        if score < 0:
            raise APIError(f"VEXEvents returned a negative skills score for {number}.")

        timestamp = format_score_timestamp(skill, event)
        aggregate = aggregates.setdefault(
            number,
            {
                "team_id": team_id,
                "number": number,
                "programming": None,
                "driver": None,
            },
        )
        if aggregate["team_id"] and team_id and aggregate["team_id"] != team_id:
            raise APIError(f"VEXEvents returned conflicting team IDs for team {number}.")
        aggregate["team_id"] = aggregate["team_id"] or team_id
        current = aggregate[skill_type]
        if current is None or score > current["score"] or (
            score == current["score"] and timestamp > current["timestamp"]
        ):
            aggregate[skill_type] = {
                "score": score,
                "timestamp": timestamp,
            }

    rows: list[dict[str, Any]] = []
    for number, aggregate in aggregates.items():
        old = previous.get(number, {})
        team = team_details.get(aggregate["team_id"], {})
        location = team.get("location") or {}
        programming = aggregate["programming"]
        driver = aggregate["driver"]
        auto_score = programming["score"] if programming else 0
        driver_score = driver["score"] if driver else 0
        rows.append(
            {
                "Rank": 0,
                "Score": auto_score + driver_score,
                "Autonomous Coding Skills": auto_score,
                "Driver Skills": driver_score,
                "Highest Autonomous Coding Skills": auto_score,
                "Highest Driver Skills": driver_score,
                "Highest Autonomous Score Timestamp": programming["timestamp"] if programming else "",
                "Highest Driver Score Timestamp": driver["timestamp"] if driver else "",
                "Highest Autonomous Score Stop Time": 0,
                "Highest Driver Score Stop Time": 0,
                "Team Number": number,
                "Team Name": team.get("team_name") or old.get("Team Name") or number,
                "Organization": team.get("organization") or old.get("Organization") or "",
                "Event Region": location.get("region") or old.get("Event Region") or "",
                "Country / Region": location.get("country") or old.get("Country / Region") or "",
            }
        )

    rows.sort(
        key=lambda row: (
            -row["Score"],
            -row["Autonomous Coding Skills"],
            -row["Driver Skills"],
            row["Team Number"],
        )
    )
    for rank, row in enumerate(rows, start=1):
        row["Rank"] = rank
    return rows


def write_snapshot(rows: list[dict[str, Any]], path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary_path: str | None = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w",
            encoding="utf-8",
            newline="",
            dir=path.parent,
            prefix=f".{path.name}.",
            suffix=".tmp",
            delete=False,
        ) as snapshot:
            temporary_path = snapshot.name
            writer = csv.DictWriter(snapshot, fieldnames=CSV_FIELDS, lineterminator="\n")
            writer.writeheader()
            writer.writerows(rows)
        os.replace(temporary_path, path)
    finally:
        if temporary_path and os.path.exists(temporary_path):
            os.unlink(temporary_path)


def refresh_snapshot(token: str, output_path: Path = OUTPUT_PATH) -> int:
    previous = read_previous_snapshot(output_path)
    season_id = current_v5_season_id(token)
    events = get_all_pages(
        "events",
        [("program[]", str(V5RC_PROGRAM_ID)), ("season[]", str(season_id))],
        token,
    )
    completed = completed_v5_events(events, season_id)
    if not completed:
        raise APIError("VEXEvents returned no completed V5RC events for the configured season.")

    skill_runs: list[tuple[dict[str, Any], dict[str, Any]]] = []
    unavailable_events = 0
    for index, event in enumerate(completed, start=1):
        event_id = event.get("id")
        if event_id is None:
            raise APIError("VEXEvents returned a completed event without an ID.")
        try:
            skills = get_all_pages(f"events/{event_id}/skills", [], token)
        except APIError as error:
            if error.status_code == 404:
                unavailable_events += 1
                continue
            raise
        skill_runs.extend((event, skill) for skill in skills)
        if index % 25 == 0:
            print(f"Fetched skills for {index}/{len(completed)} completed events.")

    if unavailable_events:
        print(f"VEXEvents had no skills endpoint for {unavailable_events} completed events.")
    if not skill_runs:
        raise APIError("No V5RC skills results were returned; the existing snapshot was left unchanged.")

    teams = fetch_team_details(collect_team_ids(skill_runs), token)
    rows = build_snapshot_rows(skill_runs, teams, previous)
    minimum_rows = max(
        MINIMUM_TEAM_COUNT,
        math.ceil(len(previous) * PREVIOUS_SNAPSHOT_MINIMUM_RATIO),
    )
    if len(rows) < minimum_rows:
        raise APIError(
            f"Only {len(rows)} teams have skills results; refusing to replace the snapshot "
            f"because at least {minimum_rows} are required."
        )

    write_snapshot(rows, output_path)
    print(
        f"Updated {output_path} with {len(rows)} teams from {len(completed)} completed "
        f"V5RC events in season {season_id}."
    )
    return len(rows)


def main() -> int:
    token = os.environ.get("VEX_EVENTS_API_TOKEN", "").strip()
    if not token:
        print("VEX_EVENTS_API_TOKEN is required; the existing snapshot was left unchanged.", file=sys.stderr)
        return 2
    try:
        refresh_snapshot(token)
    except APIError as error:
        print(f"Skills snapshot refresh failed: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
