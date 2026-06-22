import unittest

import numpy as np

from efficio import residual


class TestTheilSen(unittest.TestCase):
    def test_recovers_linear_slope(self):
        x = np.arange(10, dtype=float)
        y = 3.0 * x + 7.0
        a, b = residual.theil_sen(x, y)
        self.assertAlmostEqual(b, 3.0, places=6)
        self.assertAlmostEqual(a, 7.0, places=6)

    def test_robust_to_outlier(self):
        x = np.arange(20, dtype=float)
        y = 2.0 * x + 1.0
        y[10] += 500.0  # 단일 이상치
        _, b = residual.theil_sen(x, y)
        self.assertAlmostEqual(b, 2.0, places=6)  # median 기반이라 견고

    def test_residual_removes_size_relation(self):
        x = np.arange(15, dtype=float)
        y = 4.0 * x + 2.0
        res = residual.residualize(y, x)
        self.assertTrue(np.allclose(res, 0.0, atol=1e-6))

    def test_single_point(self):
        a, b = residual.theil_sen([5.0], [9.0])
        self.assertEqual(b, 0.0)


class TestPercentileRank(unittest.TestCase):
    def test_basic(self):
        vals = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]
        self.assertEqual(residual.percentile_rank(vals, 5), 50.0)
        self.assertEqual(residual.percentile_rank(vals, 0), 0.0)

    def test_empty(self):
        self.assertTrue(np.isnan(residual.percentile_rank([], 1.0)))


class TestSizeFactor(unittest.TestCase):
    def test_log_transform(self):
        sf = residual.size_factor([0, np.e - 1])
        self.assertAlmostEqual(sf[0], 0.0, places=6)
        self.assertAlmostEqual(sf[1], 1.0, places=6)


if __name__ == "__main__":
    unittest.main()
