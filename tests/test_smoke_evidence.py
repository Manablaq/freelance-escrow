import re
import unittest
from pathlib import Path


ROOT = Path(__file__).parents[1]
APPROVAL_PATH = ROOT / "docs" / "smoke" / "approval-deliverable.md"
REJECTION_PATH = ROOT / "docs" / "smoke" / "rejection-deliverable.txt"

PRIVATE_KEY_PATTERNS = (
    re.compile(r"\b0x[a-fA-F0-9]{64}\b"),
    re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----"),
    re.compile(r"\b(?:private[_ -]?key|secret[_ -]?key|mnemonic|seed[_ -]?phrase)\s*[:=]", re.I),
)
LOCAL_OR_SECRET_PATTERNS = (
    re.compile(r"\blocalhost\b", re.I),
    re.compile(r"\b127\.0\.0\.1\b"),
    re.compile(r"(?:^|[\s`'\"])(?:/Users/|/home/|/tmp/|[A-Za-z]:\\\\)"),
    re.compile(r"\$\{?[A-Z][A-Z0-9_]*\}?"),
    re.compile(r"\b(?:API_KEY|PRIVATE_KEY|SECRET|TOKEN|MNEMONIC|SEED_PHRASE)\b\s*=", re.I),
)


class SmokeEvidenceTests(unittest.TestCase):
    def test_evidence_files_exist(self):
        self.assertTrue(APPROVAL_PATH.is_file())
        self.assertTrue(REJECTION_PATH.is_file())

    def test_approval_evidence_is_bounded_and_covers_workflow(self):
        text = APPROVAL_PATH.read_text(encoding="utf-8")
        self.assertGreaterEqual(len(text.strip()), 500)
        self.assertLessEqual(len(text), 5_000)

        required_terms = (
            "client", "freelancer", "create a job", "funds", "escrow",
            "deliverable URL", "fetches", "semantically compares",
            "Equivalence Principle", "consensus", "70", "APPROVED", "PAID",
            "escrow balance to zero", "total_paid", "jobs_completed",
            "total_earned", "transfers", "REJECTED", "DISPUTED", "client_refund",
        )
        folded = text.casefold()
        for term in required_terms:
            with self.subTest(term=term):
                self.assertIn(term.casefold(), folded)

    def test_rejection_evidence_is_unrelated(self):
        text = REJECTION_PATH.read_text(encoding="utf-8")
        self.assertTrue(text.strip())
        forbidden = ("genlayer", "escrow", "contract", "freelance", "job", "payment", "verification")
        for term in forbidden:
            with self.subTest(term=term):
                self.assertIsNone(re.search(rf"\b{re.escape(term)}\w*\b", text, re.I))

    def test_evidence_contains_no_keys_secrets_or_local_references(self):
        for path in (APPROVAL_PATH, REJECTION_PATH):
            text = path.read_text(encoding="utf-8")
            for pattern in PRIVATE_KEY_PATTERNS + LOCAL_OR_SECRET_PATTERNS:
                with self.subTest(path=path.name, pattern=pattern.pattern):
                    self.assertIsNone(pattern.search(text))


if __name__ == "__main__":
    unittest.main()
