import pathlib
import subprocess
import unittest


class SmokeToolingTests(unittest.TestCase):
    def test_offline_node_suite(self):
        repository = pathlib.Path(__file__).resolve().parents[1]
        result = subprocess.run(
            ["node", "--test", "tests/smoke-freelance-market.test.mjs"],
            cwd=repository,
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)


if __name__ == "__main__":
    unittest.main()
