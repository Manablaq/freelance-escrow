import ast
import json
import unittest
from pathlib import Path
from types import SimpleNamespace


CONTRACT_PATH = Path(__file__).parents[1] / "contracts" / "freelance_market.py"
SOURCE = CONTRACT_PATH.read_text()
TREE = ast.parse(SOURCE)


def _load_pure_helpers():
    names = {
        "_safe_json",
        "_clean",
        "_rejection_result",
        "_evaluate_submitted_work",
        "_parse_consensus_result",
    }
    nodes = [node for node in TREE.body if isinstance(node, ast.FunctionDef) and node.name in names]
    namespace = {"json": json}
    exec(compile(ast.Module(body=nodes, type_ignores=[]), str(CONTRACT_PATH), "exec"), namespace)
    return namespace


HELPERS = _load_pure_helpers()


class _FakeWeb:
    def __init__(self, body=None, fails=False):
        self.body = body
        self.fails = fails

    def get(self, _url):
        if self.fails:
            raise RuntimeError("unavailable")
        return SimpleNamespace(body=self.body)


class _FakeNondet:
    def __init__(self, body, model_result, fails=False):
        self.web = _FakeWeb(body, fails)
        self.model_result = model_result
        self.prompt = ""

    def exec_prompt(self, prompt):
        self.prompt = prompt
        return self.model_result


def _context():
    return json.dumps({
        "title": "Build an escrow landing page",
        "description": "Create a responsive landing page with wallet connection.",
        "requirements": "Include responsive layout and a Connect Wallet action.",
        "deliverable_url": "https://example.com/work",
        "submitted_description": "Implemented the requested page.",
    })


class SemanticEvaluationTests(unittest.TestCase):
    def _evaluate(self, body, result, fails=False):
        nondet = _FakeNondet(body, json.dumps(result) if isinstance(result, dict) else result, fails)
        HELPERS["_evaluate_submitted_work"].__globals__["gl"] = SimpleNamespace(nondet=nondet)
        return json.loads(HELPERS["_evaluate_submitted_work"](_context())), nondet.prompt

    def test_relevant_completed_work_can_be_approved(self):
        result, prompt = self._evaluate(
            b"Responsive escrow landing page. Connect Wallet button and mobile layout included.",
            {"approved": True, "score": 91, "reason": "Requirements demonstrated.",
             "evidence_summary": "Fetched page shows the requested responsive wallet UI."},
        )
        self.assertTrue(result["approved"])
        self.assertIn("Connect Wallet", prompt)
        self.assertIn("untrusted webpage content", prompt)

    def test_unrelated_work_is_rejected(self):
        result, _ = self._evaluate(
            b"A cooking recipe for tomato soup.",
            {"approved": False, "score": 4, "reason": "Unrelated.",
             "evidence_summary": "Fetched content is a recipe."},
        )
        self.assertFalse(result["approved"])

    def test_inaccessible_and_empty_urls_fail_closed(self):
        inaccessible, _ = self._evaluate(b"", "unused", fails=True)
        empty, _ = self._evaluate(b"   ", "unused")
        self.assertFalse(inaccessible["approved"])
        self.assertFalse(empty["approved"])

    def test_malformed_model_output_fails_closed(self):
        malformed, _ = self._evaluate(b"real page", "not json")
        shape_only, _ = self._evaluate(
            b"real page", {"approved": True, "score": 99, "reason": "Looks good"}
        )
        self.assertFalse(malformed["approved"])
        self.assertFalse(shape_only["approved"])


class ContractStructureTests(unittest.TestCase):
    def _verify_method(self):
        contract = next(node for node in TREE.body if isinstance(node, ast.ClassDef) and node.name == "FreelanceMarket")
        return next(node for node in contract.body if isinstance(node, ast.FunctionDef) and node.name == "verify_and_release")

    def test_no_nested_function_or_lambda_in_verify_and_release(self):
        method = self._verify_method()
        nested = [node for node in ast.walk(method) if isinstance(node, (ast.FunctionDef, ast.Lambda)) and node is not method]
        self.assertEqual([], nested)

    def test_repeated_verification_is_blocked_before_payment(self):
        method_source = ast.get_source_segment(SOURCE, self._verify_method())
        self.assertIn('record["status"] == "SUBMITTED"', method_source)
        self.assertIn('record["status"] = "PAID"', method_source)
        self.assertIn('self.escrow_balances[job_id] = "0"', method_source)

    def test_consensus_is_semantic_not_json_shape_only(self):
        method_source = ast.get_source_segment(SOURCE, self._verify_method())
        self.assertIn("prompt_comparative", method_source)
        self.assertIn("actual fetched deliverable evidence", method_source)
        self.assertIn("approved fields must match exactly", method_source)
        self.assertNotIn("Validate format only", SOURCE)


if __name__ == "__main__":
    unittest.main()
