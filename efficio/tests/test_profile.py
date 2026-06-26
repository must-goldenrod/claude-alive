import unittest

from efficio import profile
from efficio.reference import fit_reference


def _unit(sid, tokens, w2, w3=0, wc=0, bash=0, ts=1.0):
    return {"session_id": sid, "total_tokens": tokens, "w2_raw": w2,
            "w3_raw": w3, "wc_raw": wc, "bash_raw": bash, "project": "p", "ai_title": sid,
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
        self.assertEqual(keys, {"w2", "w3", "wc", "bash"})
        w2_axis = next(a for a in prof["axes"] if a["key"] == "w2")
        self.assertEqual(w2_axis["status"], "subj")        # 주관(H1) 검증
        self.assertEqual(w2_axis["cluster"], "체감")
        bash_axis = next(a for a in prof["axes"] if a["key"] == "bash")
        self.assertEqual(bash_axis["cluster"], "행동")     # 객관 행동축

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


class TestExportScores(unittest.TestCase):
    def setUp(self):
        self.units = [_unit(f"s{i}", 1_000_000, w2=1000 * i, wc=i, ts=float(i))
                      for i in range(5)]
        self.model = fit_reference(self.units, fit_at=1.0)

    def test_one_row_per_session_per_axis(self):
        rows = profile.export_scores(self.units, self.model)
        self.assertEqual(len(rows), 5 * 4)              # 세션 5 × 축 4
        for r in rows:
            self.assertEqual(
                set(r), {"session_id", "axis", "actual", "baseline",
                         "residual", "waste_percentile", "is_zero"})

    def test_matches_apply_reference(self):
        # export는 profile/timeline과 동일한 고정 모델 계산이어야 한다(드리프트 단일출처)
        rows = profile.export_scores(self.units, self.model)
        prof = profile.session_profile(self.units, "s3", self.model)
        w2_axis = next(a for a in prof["axes"] if a["key"] == "w2")
        w2_row = next(r for r in rows if r["session_id"] == "s3" and r["axis"] == "w2")
        self.assertEqual(w2_row["residual"], w2_axis["residual"])
        self.assertEqual(w2_row["waste_percentile"], w2_axis["waste_percentile"])
        self.assertEqual(w2_row["baseline"], w2_axis["baseline"])

    def test_full_session_ids_preserved(self):
        # 시계열 조인을 위해 export는 8자 접두어가 아닌 full id를 보존해야 한다
        rows = profile.export_scores(self.units, self.model)
        self.assertTrue(all(r["session_id"] in {u["session_id"] for u in self.units}
                            for r in rows))


if __name__ == "__main__":
    unittest.main()
