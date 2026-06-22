import unittest

from efficio import profile
from efficio.reference import fit_reference


def _unit(sid, tokens, w2, w3=0, wc=0, ts=1.0):
    return {"session_id": sid, "total_tokens": tokens, "w2_raw": w2,
            "w3_raw": w3, "wc_raw": wc, "project": "p", "ai_title": sid,
            "turns": 5, "ts_first": ts}


class TestSessionProfile(unittest.TestCase):
    def setUp(self):
        # 같은 크기(tokens)에서 W2만 다른 두 세션 + 채우기용
        self.units = [_unit(f"f{i}", 1_000_000, w2=10_000 + i * 1000, ts=float(i))
                      for i in range(10)]
        self.units.append(_unit("low", 1_000_000, w2=0, ts=20.0))
        self.units.append(_unit("high", 1_000_000, w2=999_999, ts=21.0))
        self.model = fit_reference(self.units, fit_at=1.0)

    def test_profile_structure(self):
        prof = profile.session_profile(self.units, "high", self.model)
        self.assertIsNotNone(prof)
        self.assertEqual(prof["primary"], "w2")
        keys = {a["key"] for a in prof["axes"]}
        self.assertEqual(keys, {"w2", "w3", "wc"})
        w2_axis = next(a for a in prof["axes"] if a["key"] == "w2")
        self.assertEqual(w2_axis["status"], "validated")

    def test_higher_w2_gets_higher_percentile(self):
        low = profile.session_profile(self.units, "low", self.model)
        high = profile.session_profile(self.units, "high", self.model)
        low_pct = next(a["waste_percentile"] for a in low["axes"] if a["key"] == "w2")
        high_pct = next(a["waste_percentile"] for a in high["axes"] if a["key"] == "w2")
        self.assertGreater(high_pct, low_pct)

    def test_zero_signal_flagged(self):
        prof = profile.session_profile(self.units, "low", self.model)
        w2_axis = next(a for a in prof["axes"] if a["key"] == "w2")
        # low 세션은 w2_raw=0 → is_zero
        self.assertTrue(w2_axis["is_zero"])

    def test_unknown_session_returns_none(self):
        self.assertIsNone(profile.session_profile(self.units, "nonexistent", self.model))


class TestTimeline(unittest.TestCase):
    def setUp(self):
        self.units = [_unit(f"s{i}", 1_000_000, w2=1000 * i, ts=float(i)) for i in range(30)]
        self.model = fit_reference(self.units, fit_at=1.0)

    def test_respects_last_n_and_order(self):
        rows = profile.timeline(self.units, self.model, axis="w2", last_n=5)
        self.assertEqual(len(rows), 5)
        ts = [r["ts_first"] for r in rows]
        self.assertEqual(ts, sorted(ts))            # 시간 오름차순
        self.assertEqual(rows[-1]["session_id"], "s29")  # 최신 포함

    def test_rows_have_required_fields(self):
        rows = profile.timeline(self.units, self.model, axis="w2", last_n=3)
        for r in rows:
            self.assertIn("waste_percentile", r)
            self.assertIn("residual", r)


if __name__ == "__main__":
    unittest.main()
