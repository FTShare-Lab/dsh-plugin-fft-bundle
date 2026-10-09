"""Regression guard for the diagnose payload the HTML report is built from.

`_maybe_write_html` used to require a top-level `none` mapping that no producer
ever wrote, so `--html` silently produced nothing. The report is the whole point
of this skill, so the payload shapes it accepts are pinned here.
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import factor_lib  # noqa: E402


class DiagnosticsPayload(unittest.TestCase):
    def test_accepts_a_bare_evaluation_summary(self) -> None:
        summary = {"modes": {"none": {"rank_ic": 0.01}}}
        self.assertIs(factor_lib._diagnostics_payload(summary), summary)

    def test_accepts_a_whole_command_result(self) -> None:
        nested = {"modes": {"none": {"rank_ic": 0.01}}}
        out = {"eval": nested, "coverage": {}}
        self.assertIs(factor_lib._diagnostics_payload(out), nested)

    def test_rejects_a_result_without_an_evaluation(self) -> None:
        self.assertIsNone(factor_lib._diagnostics_payload({"coverage": {}}))
        self.assertIsNone(factor_lib._diagnostics_payload({"modes": "none"}))
        self.assertIsNone(factor_lib._diagnostics_payload({"eval": {"modes": None}}))

    def test_rejects_a_non_mapping(self) -> None:
        for value in (None, [], "modes", 3):
            self.assertIsNone(factor_lib._diagnostics_payload(value))


if __name__ == "__main__":
    unittest.main()
