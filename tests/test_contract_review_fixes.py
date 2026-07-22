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
        "_reject_duplicate_json_keys",
        "_parse_evaluator_output",
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
    def __init__(self, body, model_result, web_fails=False, model_fails=False):
        self.web = _FakeWeb(body, web_fails)
        self.model_result = model_result
        self.model_fails = model_fails
        self.prompt = ""

    def exec_prompt(self, prompt):
        self.prompt = prompt
        if self.model_fails:
            raise RuntimeError("model unavailable")
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
    def _evaluate(self, body, result, web_fails=False, model_fails=False):
        nondet = _FakeNondet(
            body,
            result,
            web_fails,
            model_fails,
        )
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
        inaccessible, _ = self._evaluate(b"", "unused", web_fails=True)
        empty, _ = self._evaluate(b"   ", "unused")
        self.assertFalse(inaccessible["approved"])
        self.assertFalse(empty["approved"])

    def test_supported_model_output_representations_are_accepted(self):
        payload = {
            "approved": True,
            "score": 91,
            "reason": "Requirements demonstrated.",
            "evidence_summary": "Fetched content demonstrates the requested work.",
        }
        encoded = json.dumps(payload)

        representations = [
            payload,
            encoded,
            encoded.encode("utf-8"),
            "```json\n" + encoded + "\n```",
            "Evaluator result:\n" + encoded,
        ]

        for representation in representations:
            with self.subTest(representation_type=type(representation).__name__):
                result, _ = self._evaluate(b"real page", representation)
                self.assertTrue(result["approved"])
                self.assertEqual(91, result["score"])

        self.assertEqual(
            payload,
            HELPERS["_parse_evaluator_output"](payload),
        )

    def test_ambiguous_or_unsupported_model_output_fails_closed(self):
        valid = json.dumps({
            "approved": False,
            "score": 0,
            "reason": "Insufficient evidence.",
            "evidence_summary": "The fetched evidence is incomplete.",
        })

        cases = [
            "not json",
            valid + "\n" + valid,
            ["unsupported"],
            123,
            "x" * 4001,
            "```python\n" + valid + "\n```",
            (
                '{"approved":false,"approved":true,'
                '"score":99,"reason":"ok",'
                '"evidence_summary":"ok"}'
            ),
            (
                '{"approved":true,"score":69,"score":99,'
                '"reason":"ok","evidence_summary":"ok"}'
            ),
            (
                '{"approved":true,"score":99,'
                '"reason":"no","reason":"yes",'
                '"evidence_summary":"ok"}'
            ),
            (
                '{"approved":true,"score":99,'
                '"reason":"ok","evidence_summary":"no",'
                '"evidence_summary":"yes"}'
            ),
        ]

        for model_result in cases:
            with self.subTest(model_result_type=type(model_result).__name__):
                result, _ = self._evaluate(b"real page", model_result)
                self.assertFalse(result["approved"])
                self.assertEqual(
                    "The evaluator returned malformed output.",
                    result["reason"],
                )

    def test_dict_outputs_are_bounded_and_json_compatible(self):
        oversized = {
            "approved": True,
            "score": 99,
            "reason": "x" * 4001,
            "evidence_summary": "Evidence.",
        }
        non_json = {
            "approved": True,
            "score": 99,
            "reason": object(),
            "evidence_summary": "Evidence.",
        }
        non_finite = {
            "approved": True,
            "score": 99,
            "reason": float("nan"),
            "evidence_summary": "Evidence.",
        }

        for model_result in (oversized, non_json, non_finite):
            with self.subTest(model_result=model_result):
                result, _ = self._evaluate(b"real page", model_result)
                self.assertFalse(result["approved"])
                self.assertEqual(
                    "The evaluator returned malformed output.",
                    result["reason"],
                )

    def test_threshold_boolean_score_and_cleaned_evidence_boundaries(self):
        below, _ = self._evaluate(
            b"real page",
            {
                "approved": True,
                "score": 69,
                "reason": "Nearly complete.",
                "evidence_summary": "Most work is present.",
            },
        )
        at_threshold, _ = self._evaluate(
            b"real page",
            {
                "approved": True,
                "score": 70,
                "reason": (" " * 500) + "Completed.",
                "evidence_summary": ("\t" * 500) + "Evidence.",
            },
        )
        boolean_score, _ = self._evaluate(
            b"real page",
            {
                "approved": True,
                "score": True,
                "reason": "Invalid score.",
                "evidence_summary": "Invalid score type.",
            },
        )

        self.assertFalse(below["approved"])
        self.assertEqual(
            "The evaluator approval did not meet the completion threshold.",
            below["reason"],
        )

        self.assertTrue(at_threshold["approved"])
        self.assertEqual(70, at_threshold["score"])
        self.assertEqual("Completed.", at_threshold["reason"])
        self.assertEqual("Evidence.", at_threshold["evidence_summary"])

        self.assertFalse(boolean_score["approved"])
        self.assertEqual(
            "The evaluator returned malformed or incomplete evidence.",
            boolean_score["reason"],
        )

    def test_unknown_fields_fail_closed_and_never_enter_evidence(self):
        hostile_value = "HOSTILE_UNKNOWN_FIELD_VALUE"
        model_result = json.dumps({
            "approved": True,
            "score": 99,
            "reason": "Complete.",
            "evidence_summary": "Evidence.",
            "hostile": hostile_value,
        })

        result, _ = self._evaluate(b"real page", model_result)
        serialized = json.dumps(result, sort_keys=True)

        self.assertFalse(result["approved"])
        self.assertNotIn("hostile", result)
        self.assertNotIn(hostile_value, serialized)
        self.assertEqual(
            "The evaluator returned malformed output.",
            result["reason"],
        )

    def test_model_call_failure_is_distinguished_and_fails_closed(self):
        result, _ = self._evaluate(
            b"real page",
            "unused",
            model_fails=True,
        )
        self.assertFalse(result["approved"])
        self.assertEqual(
            "The evaluator model call failed.",
            result["reason"],
        )

    def test_malformed_model_output_fails_closed(self):
        malformed, _ = self._evaluate(b"real page", "not json")
        shape_only, _ = self._evaluate(
            b"real page", {"approved": True, "score": 99, "reason": "Looks good"}
        )
        self.assertFalse(malformed["approved"])
        self.assertEqual(
            "The evaluator returned malformed output.",
            malformed["reason"],
        )
        self.assertFalse(shape_only["approved"])
        self.assertEqual(
            "The evaluator returned malformed output.",
            shape_only["reason"],
        )


class ConsensusParserTests(unittest.TestCase):
    def _parse(self, value):
        return HELPERS["_parse_consensus_result"](value)

    def _payload(self, approved=True, score=70, reason="Complete.",
                 evidence_summary="Evidence."):
        return {
            "approved": approved,
            "score": score,
            "reason": reason,
            "evidence_summary": evidence_summary,
        }

    def _assert_rejected(self, value):
        result = self._parse(value)
        self.assertFalse(result["approved"])
        self.assertEqual(0, result["score"])
        self.assertEqual(
            "Consensus returned malformed or insufficient evidence.",
            result["reason"],
        )
        self.assertEqual(
            {
                "approved",
                "score",
                "reason",
                "evidence_summary",
            },
            set(result),
        )
        return result

    def test_duplicate_keys_fail_closed_at_settlement_boundary(self):
        cases = [
            (
                '{"approved":false,"approved":true,'
                '"score":99,"reason":"ok",'
                '"evidence_summary":"ok"}'
            ),
            (
                '{"approved":true,"score":69,"score":99,'
                '"reason":"ok","evidence_summary":"ok"}'
            ),
            (
                '{"approved":true,"score":99,'
                '"reason":"no","reason":"yes",'
                '"evidence_summary":"ok"}'
            ),
            (
                '{"approved":true,"score":99,'
                '"reason":"ok","evidence_summary":"no",'
                '"evidence_summary":"yes"}'
            ),
        ]

        for value in cases:
            with self.subTest(value=value):
                self._assert_rejected(value)

    def test_unknown_trailing_missing_and_malformed_consensus_fail_closed(self):
        valid = json.dumps(self._payload())
        hostile_value = "HOSTILE_CONSENSUS_VALUE"

        cases = [
            "not json",
            valid + "\n" + valid,
            valid + " trailing",
            json.dumps({
                **self._payload(),
                "hostile": hostile_value,
            }),
            json.dumps({
                "approved": True,
                "score": 99,
                "reason": "Missing summary.",
            }),
        ]

        for value in cases:
            with self.subTest(value=value):
                result = self._assert_rejected(value)
                self.assertNotIn(
                    hostile_value,
                    json.dumps(result, sort_keys=True),
                )

    def test_consensus_threshold_and_score_types_are_enforced(self):
        below = self._parse(json.dumps(
            self._payload(approved=True, score=69)
        ))
        at_threshold = self._parse(json.dumps(
            self._payload(approved=True, score=70)
        ))
        maximum = self._parse(json.dumps(
            self._payload(approved=True, score=100)
        ))
        boolean_score = self._parse(json.dumps(
            self._payload(approved=True, score=True)
        ))
        over_maximum = self._parse(json.dumps(
            self._payload(approved=True, score=101)
        ))

        self.assertFalse(below["approved"])
        self.assertTrue(at_threshold["approved"])
        self.assertEqual(70, at_threshold["score"])
        self.assertTrue(maximum["approved"])
        self.assertEqual(100, maximum["score"])
        self.assertFalse(boolean_score["approved"])
        self.assertFalse(over_maximum["approved"])

    def test_consensus_cleaned_strings_remain_nonempty_and_bounded(self):
        normalized = self._parse(json.dumps(self._payload(
            reason=(" " * 500) + "Completed.",
            evidence_summary=("\t" * 500) + "Evidence.",
        )))
        blank_reason = self._parse(json.dumps(self._payload(
            reason=" " * 600,
        )))
        blank_summary = self._parse(json.dumps(self._payload(
            evidence_summary="\t" * 600,
        )))
        bounded = self._parse(json.dumps(self._payload(
            reason="r" * 700,
            evidence_summary="e" * 700,
        )))

        self.assertTrue(normalized["approved"])
        self.assertEqual("Completed.", normalized["reason"])
        self.assertEqual("Evidence.", normalized["evidence_summary"])

        self.assertFalse(blank_reason["approved"])
        self.assertFalse(blank_summary["approved"])

        self.assertTrue(bounded["approved"])
        self.assertEqual(500, len(bounded["reason"]))
        self.assertEqual(500, len(bounded["evidence_summary"]))


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
