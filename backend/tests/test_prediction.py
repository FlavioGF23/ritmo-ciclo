import unittest
from datetime import date, timedelta

from app.prediction import estimate


class PredictionTest(unittest.TestCase):
    def setUp(self):
        self.start = date(2026, 10, 30)

    def test_single_record_and_declared_length(self):
        self.assertEqual(
            estimate([self.start], 28),
            {
                "status": "estimated",
                "basis": "declared",
                "cycle_length": 28,
                "next_period": "2026-11-27",
                "ovulation": "2026-11-12",
                "fertile_from": "2026-11-07",
                "fertile_to": "2026-11-12",
            },
        )

    def test_history_takes_precedence_and_rounds_up(self):
        starts = [self.start + timedelta(days=day) for day in (57, 28, 0)]
        result = estimate(starts, 24)
        self.assertEqual(result["basis"], "history")
        self.assertEqual(result["cycle_length"], 29)

    def test_insufficient_data(self):
        self.assertEqual(estimate([], 28), {"status": "insufficient"})
        self.assertEqual(estimate([self.start], None), {"status": "insufficient"})
        self.assertEqual(
            estimate([self.start - timedelta(days=28), self.start], None),
            {"status": "insufficient"},
        )

    def test_no_precise_dates_for_irregular_cycles(self):
        for starts, length, irregular in (
            ([self.start], 28, True),
            ([self.start], 46, False),
            ([self.start, self.start + timedelta(days=41)], 28, False),
            ([self.start + timedelta(days=d) for d in (0, 23, 55)], 28, False),
        ):
            with self.subTest(length=length, irregular=irregular):
                self.assertEqual(estimate(starts, length, irregular), {"status": "irregular"})
