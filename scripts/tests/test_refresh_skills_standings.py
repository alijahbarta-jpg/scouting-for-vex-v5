import csv
import os
import sys
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import refresh_skills_standings as snapshot


class RefreshSkillsStandingsTests(unittest.TestCase):
    def setUp(self):
        self.events = {
            "1": {"id": 1, "start": "2026-10-01T10:00:00Z", "end": "2026-10-02T18:00:00Z"},
            "2": {"id": 2, "start": "2026-10-20T10:00:00Z", "end": "2026-10-21T18:00:00Z"},
        }
        self.teams = {
            "101": {
                "id": 101,
                "number": "123A",
                "team_name": "Alpha",
                "organization": "School A",
                "location": {"region": "Region A", "country": "Country A"},
            },
            "102": {
                "id": 102,
                "number": "456B",
                "team_name": "Beta",
                "organization": "School B",
                "location": {"region": "Region B", "country": "Country B"},
            },
        }

    def test_completed_events_filters_program_season_and_future_events(self):
        now = datetime(2026, 11, 1, tzinfo=timezone.utc)
        events = [
            {
                "program": {"id": 1},
                "season": {"id": 204},
                "end": "2026-10-21T18:00:00Z",
            },
            {
                "program": {"id": 41},
                "season": {"id": 204},
                "end": "2026-10-21T18:00:00Z",
            },
            {
                "program": {"id": 1},
                "season": {"id": 197},
                "end": "2026-10-21T18:00:00Z",
            },
            {
                "program": {"id": 1},
                "season": {"id": 204},
                "end": "2026-12-21T18:00:00Z",
            },
        ]
        self.assertEqual(len(snapshot.completed_v5_events(events, 204, now)), 1)

    def test_current_season_is_selected_from_authoritative_dates(self):
        seasons = [
            {"id": 197, "program": {"id": 1}, "start": "2025-04-01T00:00:00Z", "end": "2026-06-01T00:00:00Z"},
            {"id": 204, "program": {"id": 1}, "start": "2026-04-01T00:00:00Z", "end": "2027-06-01T00:00:00Z"},
            {"id": 203, "program": {"id": 41}, "start": "2026-04-01T00:00:00Z", "end": "2027-06-01T00:00:00Z"},
        ]
        now = datetime(2026, 5, 1, tzinfo=timezone.utc)
        with patch.object(snapshot, "get_all_pages", return_value=seasons):
            self.assertEqual(snapshot.current_v5_season_id("test", now), 204)

    def test_current_season_refuses_duplicate_latest_start_dates(self):
        seasons = [
            {"id": 204, "program": {"id": 1}, "start": "2026-04-01T00:00:00Z", "end": "2027-06-01T00:00:00Z"},
            {"id": 205, "program": {"id": 1}, "start": "2026-04-01T00:00:00Z", "end": "2027-10-01T00:00:00Z"},
        ]
        now = datetime(2026, 11, 1, tzinfo=timezone.utc)
        with patch.object(snapshot, "get_all_pages", return_value=seasons):
            with self.assertRaises(snapshot.APIError):
                snapshot.current_v5_season_id("test", now)

    def test_build_snapshot_uses_best_run_and_deterministic_ranks(self):
        skill_runs = [
            (self.events["1"], {"team": {"id": 101, "name": "123A"}, "type": "programming", "score": 40}),
            (self.events["2"], {"team": {"id": 101, "name": "123A"}, "type": "programming", "score": 50}),
            (self.events["1"], {"team": {"id": 101, "name": "123A"}, "type": "driver", "score": 50}),
            (self.events["2"], {"team": {"id": 102, "name": "456B"}, "type": "programming", "score": 50}),
            (self.events["2"], {"team": {"id": 102, "name": "456B"}, "type": "driver", "score": 50}),
        ]

        rows = snapshot.build_snapshot_rows(skill_runs, self.teams, {})

        self.assertEqual([row["Rank"] for row in rows], [1, 2])
        self.assertEqual(rows[0]["Team Number"], "123A")
        self.assertEqual(rows[0]["Score"], 100)
        self.assertEqual(rows[0]["Highest Autonomous Coding Skills"], 50)
        self.assertEqual(rows[0]["Highest Autonomous Score Timestamp"], "2026-10-21 18:00:00")
        self.assertEqual(rows[0]["Team Name"], "Alpha")
        self.assertEqual(rows[0]["Organization"], "School A")
        self.assertEqual(rows[1]["Team Number"], "456B")

    def test_metadata_falls_back_to_existing_snapshot_for_unknown_team(self):
        old = {
            "999X": {
                "Team Name": "Retained name",
                "Organization": "Retained org",
                "Event Region": "Retained region",
                "Country / Region": "Retained country",
            }
        }
        runs = [(self.events["1"], {"team": {"id": 999, "name": "999X"}, "type": "driver", "score": 12})]

        row = snapshot.build_snapshot_rows(runs, {}, old)[0]

        self.assertEqual(row["Team Name"], "Retained name")
        self.assertEqual(row["Organization"], "Retained org")
        self.assertEqual(row["Event Region"], "Retained region")
        self.assertEqual(row["Country / Region"], "Retained country")
        self.assertEqual(row["Highest Autonomous Score Timestamp"], "")

    def test_write_snapshot_preserves_app_csv_shape(self):
        rows = snapshot.build_snapshot_rows(
            [(self.events["1"], {"team": {"id": 101, "name": "123A"}, "type": "driver", "score": 12})],
            self.teams,
            {},
        )
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "skills-standings.csv"
            snapshot.write_snapshot(rows, output)
            with output.open(encoding="utf-8", newline="") as file:
                reader = csv.DictReader(file)
                self.assertEqual(tuple(reader.fieldnames or ()), snapshot.CSV_FIELDS)
                self.assertEqual(next(reader)["Team Number"], "123A")

    def test_refresh_writes_a_complete_snapshot_after_fetching_all_sources(self):
        now = datetime.now(timezone.utc)
        event = {
            "id": 700,
            "program": {"id": snapshot.V5RC_PROGRAM_ID},
            "season": {"id": 204},
            "start": (now - timedelta(days=2)).isoformat(),
            "end": (now - timedelta(days=1)).isoformat(),
        }
        team_rows = [
            {
                "team": {"id": team_id, "name": f"{team_id}A"},
                "type": skill_type,
                "score": score,
            }
            for team_id in range(1, snapshot.MINIMUM_TEAM_COUNT + 1)
            for skill_type, score in (("programming", 20), ("driver", 30))
        ]
        teams = [
            {
                "id": team_id,
                "number": f"{team_id}A",
                "team_name": f"Team {team_id}",
                "organization": "School",
                "location": {"region": "Region", "country": "Country"},
            }
            for team_id in range(1, snapshot.MINIMUM_TEAM_COUNT + 1)
        ]

        def fake_pages(path, _params, _token):
            if path == "events":
                return [event]
            if path == "events/700/skills":
                return team_rows
            if path == "teams":
                return teams
            raise AssertionError(f"Unexpected API path: {path}")

        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "skills-standings.csv"
            with patch.object(snapshot, "current_v5_season_id", return_value=204):
                with patch.object(snapshot, "get_all_pages", side_effect=fake_pages):
                    count = snapshot.refresh_snapshot("test-token", output)

            self.assertEqual(count, snapshot.MINIMUM_TEAM_COUNT)
            with output.open(encoding="utf-8", newline="") as file:
                reader = csv.DictReader(file)
                rows = list(reader)
            self.assertEqual(len(rows), snapshot.MINIMUM_TEAM_COUNT)
            self.assertEqual(rows[0]["Team Number"], "100A")
            self.assertEqual(rows[0]["Score"], "50")

    def test_refresh_requires_token_without_touching_snapshot(self):
        with patch.dict(os.environ, {"VEX_EVENTS_API_TOKEN": ""}):
            self.assertEqual(snapshot.main(), 2)

    def test_api_failure_leaves_previous_snapshot_unchanged(self):
        skill_runs = [
            (self.events["1"], {"team": {"id": team_id, "name": f"{team_id}A"}, "type": skill_type, "score": score})
            for team_id in range(1, snapshot.MINIMUM_TEAM_COUNT + 1)
            for skill_type, score in (("programming", 20), ("driver", 30))
        ]
        teams = {
            str(team_id): {
                "id": team_id,
                "number": f"{team_id}A",
                "team_name": f"Team {team_id}",
            }
            for team_id in range(1, snapshot.MINIMUM_TEAM_COUNT + 1)
        }

        def fake_pages(path, _params, _token):
            if path == "events":
                return [
                    {
                        "id": 700,
                        "program": {"id": 1},
                        "season": {"id": 204},
                        "end": "2026-10-02T18:00:00Z",
                    }
                ]
            if path == "events/700/skills":
                raise snapshot.APIError("upstream failure", 502)
            if path == "teams":
                return list(teams.values())
            raise AssertionError(f"Unexpected API path: {path}")

        old_rows = snapshot.build_snapshot_rows(skill_runs, teams, {})
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "skills-standings.csv"
            snapshot.write_snapshot(old_rows, output)
            original = output.read_bytes()
            with patch.object(snapshot, "current_v5_season_id", return_value=204):
                with patch.object(snapshot, "get_all_pages", side_effect=fake_pages):
                    with self.assertRaises(snapshot.APIError):
                        snapshot.refresh_snapshot("test-token", output)
            self.assertEqual(output.read_bytes(), original)


if __name__ == "__main__":
    unittest.main()
