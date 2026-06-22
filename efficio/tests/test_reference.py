import unittest

import numpy as np

from efficio import reference
from efficio.residual import size_factor, theil_sen
from efficio.store import Store


def _unit(sid, tokens, w2, w3=0, wc=0, bash=0):
    return {"session_id": sid, "total_tokens": tokens,
            "w2_raw": w2, "w3_raw": w3, "wc_raw": wc, "bash_raw": bash,
            "project": "p", "ai_title": sid, "turns": 5, "ts_first": 1.0}


def _corpus(n, seed=0):
    rng = np.random.RandomState(seed)
    units = []
    for i in range(n):
        tok = int(np.exp(rng.uniform(10, 18)))
        size = np.log(tok + 1)
        w2 = max(0, int(5000 * size + rng.normal(0, 3000)))  # 크기 종속 + 노이즈
        units.append(_unit(f"s{i}", tok, w2, w3=rng.randint(0, 4), wc=rng.randint(0, 3)))
    return units


class TestFitApply(unittest.TestCase):
    def test_apply_matches_direct_theil_sen(self):
        units = _corpus(30)
        model = reference.fit_reference(units, fit_at=100.0)
        size = size_factor([u["total_tokens"] for u in units])
        raw = np.array([u["w2_raw"] for u in units], float)
        a, b = theil_sen(size, raw)
        # 기준집합 자기 자신에 적용한 잔차 == 직접 계산 잔차
        for i, u in enumerate(units):
            applied = reference.apply_reference(model, u)
            self.assertAlmostEqual(applied["r_w2"], raw[i] - (a + b * size[i]), places=4)

    def test_model_is_json_serializable(self):
        import json
        model = reference.fit_reference(_corpus(20), fit_at=1.0)
        json.dumps(model)  # 예외 없어야 함
        self.assertIn("w2", model["axes"])
        self.assertEqual(model["n"], 20)


class TestFrozenReproducibility(unittest.TestCase):
    """핵심 성질: 모델을 고정하면 코퍼스가 늘어도 같은 세션 점수가 불변."""

    def test_residual_and_percentile_stable_under_corpus_growth(self):
        base = _corpus(25, seed=1)
        model = reference.fit_reference(base, fit_at=1.0)   # 한 번 고정
        target = base[7]

        before = reference.apply_reference(model, target)

        # 코퍼스를 크게 늘림 (그러나 같은 고정 모델 사용)
        _ = base + _corpus(80, seed=2)
        after = reference.apply_reference(model, target)

        self.assertEqual(before["r_w2"], after["r_w2"])
        self.assertEqual(before["pct_w2"], after["pct_w2"])

    def test_refit_changes_model_but_old_model_reproduces(self):
        base = _corpus(25, seed=1)
        m1 = reference.fit_reference(base, fit_at=1.0)
        target = base[3]
        r_under_m1 = reference.apply_reference(m1, target)["r_w2"]

        m2 = reference.fit_reference(base + _corpus(50, seed=9), fit_at=2.0)
        # 새 모델은 다를 수 있음
        self.assertNotEqual(m1["axes"]["w2"]["slope"], m2["axes"]["w2"]["slope"])
        # 그러나 옛 모델로는 동일 재현
        self.assertEqual(reference.apply_reference(m1, target)["r_w2"], r_under_m1)


class TestStoreReference(unittest.TestCase):
    def test_save_load_roundtrip_and_versioning(self):
        store = Store(":memory:")
        try:
            m1 = reference.fit_reference(_corpus(20), fit_at=10.0)
            v1 = store.save_reference(m1)
            loaded = store.load_reference()
            self.assertIsNotNone(loaded)
            self.assertEqual(loaded["model_version"], v1)
            self.assertAlmostEqual(loaded["axes"]["w2"]["slope"], m1["axes"]["w2"]["slope"], places=6)

            m2 = reference.fit_reference(_corpus(30, seed=5), fit_at=20.0)
            v2 = store.save_reference(m2)
            self.assertGreater(v2, v1)
            self.assertEqual(store.load_reference()["model_version"], v2)  # 최신 활성
        finally:
            store.close()

    def test_load_none_when_empty(self):
        store = Store(":memory:")
        try:
            self.assertIsNone(store.load_reference())
        finally:
            store.close()


if __name__ == "__main__":
    unittest.main()
