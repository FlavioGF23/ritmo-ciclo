from datetime import date, timedelta
from math import floor
from statistics import mean


def estimate(starts: list[date], usual_length: int | None, irregular: bool = False) -> dict:
    """A calendar estimate. The input contains the first day of each period."""
    ordered = sorted(set(starts))[-7:]
    lengths = [(end - start).days for start, end in zip(ordered, ordered[1:])]
    if (
        irregular
        or any(not 21 <= length <= 35 for length in lengths)
        or (lengths and max(lengths) - min(lengths) > 7)
        or (len(lengths) < 2 and usual_length is not None and not 21 <= usual_length <= 35)
    ):
        return {"status": "irregular"}

    if not ordered or (len(lengths) < 2 and usual_length is None):
        return {"status": "insufficient"}

    from_history = len(lengths) >= 2
    length = floor(mean(lengths) + .5) if from_history else usual_length
    start = ordered[-1]
    next_period = start + timedelta(days=length)
    # The start date is cycle day 1; on a 28-day cycle this estimates day 14.
    ovulation = start + timedelta(days=length - 15)
    return {
        "status": "estimated",
        "basis": "history" if from_history else "declared",
        "cycle_length": length,
        "next_period": next_period.isoformat(),
        "ovulation": ovulation.isoformat(),
        "fertile_from": (ovulation - timedelta(days=5)).isoformat(),
        "fertile_to": ovulation.isoformat(),
    }
