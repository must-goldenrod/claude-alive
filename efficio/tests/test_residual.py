"""residual.py 수치 동작 고정 — numpy 제거(stdlib 순화) 후에도 동일 출력 보장.

기댓값은 손계산 가능한 합성 입력. numpy 버전과 stdlib 버전이 같은 값을 내야 한다
(Theil–Sen은 중앙값 기반이라 구현 무관 결정론적).
"""
import math
import unittest

from efficio import residual


class TestTheilSen(unittest.TestCase):
    def test_recovers_linear_slope(self):
        x = [float(i) for i in range(10)]
        y = [3.0 * xi + 7.0 for xi in x]
        a, b = residual.theil_sen(x, y)
        self.assertAlmostEqual(b, 3.0, places=6)
        self.assertAlmostEqual(a, 7.0, places=6)

    def test_robust_to_outlier(self):
        x = [float(i) for i in range(20)]
        y = [2.0 * xi + 1.0 for xi in x]
        y[10] += 500.0  # 단일 이상치
        _, b = residual.theil_sen(x, y)
        self.assertAlmostEqual(b, 2.0, places=6)  # median 기반이라 견고

    def test_single_point(self):
        a, b = residual.theil_sen([5.0], [9.0])
        self.assertEqual(b, 0.0)
        self.assertEqual(a, 9.0)

    def test_empty(self):
        self.assertEqual(residual.theil_sen([], []), (0.0, 0.0))

    def test_all_x_equal(self):
        # 모든 dx=0 → slope 0, intercept = median(y)
        a, b = residual.theil_sen([2.0, 2.0, 2.0], [1.0, 5.0, 9.0])
        self.assertEqual(b, 0.0)
        self.assertAlmostEqual(a, 5.0)

    def test_median_of_pair_slopes(self):
        # 점 (0,0),(1,1),(2,10): 쌍기울기 {1, 5, 9} → median 5
        _, b = residual.theil_sen([0.0, 1.0, 2.0], [0.0, 1.0, 10.0])
        self.assertAlmostEqual(b, 5.0)


class TestPercentileRank(unittest.TestCase):
    def test_basic(self):
        vals = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]
        self.assertEqual(residual.percentile_rank(vals, 5), 50.0)
        self.assertEqual(residual.percentile_rank(vals, 0), 0.0)

    def test_above_all(self):
        self.assertEqual(residual.percentile_rank([1.0, 2.0, 3.0], 99.0), 100.0)

    def test_empty(self):
        self.assertTrue(math.isnan(residual.percentile_rank([], 1.0)))


class TestSizeFactor(unittest.TestCase):
    def test_log_transform(self):
        sf = list(residual.size_factor([0, math.e - 1]))
        self.assertAlmostEqual(sf[0], 0.0, places=6)
        self.assertAlmostEqual(sf[1], 1.0, places=6)


class TestResidualize(unittest.TestCase):
    def test_residual_removes_size_relation(self):
        x = [float(i) for i in range(15)]
        y = [4.0 * xi + 2.0 for xi in x]
        res = list(residual.residualize(y, x))
        for r in res:
            self.assertAlmostEqual(r, 0.0, places=6)


if __name__ == "__main__":
    unittest.main()
