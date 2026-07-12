import unittest
from pathlib import Path


ROOT = Path(__file__).parents[1]
PROVIDERS = (ROOT / "app" / "providers.tsx").read_text(encoding="utf-8")
ENV_EXAMPLE = (ROOT / ".env.example").read_text(encoding="utf-8")


class WalletConnectConfigurationTests(unittest.TestCase):
    def test_walletconnect_uses_public_environment_configuration(self):
        self.assertIn("process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID", PROVIDERS)
        self.assertIn("projectId: walletConnectProjectId", PROVIDERS)
        self.assertNotIn("freelance-escrow-genlayer", PROVIDERS)
        self.assertNotIn('projectId: "YOUR_PROJECT_ID"', PROVIDERS)

    def test_missing_project_id_preserves_injected_wallets_without_fake_fallback(self):
        self.assertIn("createConfig", PROVIDERS)
        self.assertIn("connectors: [injected()]", PROVIDERS)
        self.assertIn(
            "process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID?.trim()",
            PROVIDERS,
        )
        self.assertIn("const config = walletConnectProjectId", PROVIDERS)

    def test_environment_example_documents_public_project_id(self):
        self.assertEqual(
            1,
            ENV_EXAMPLE.splitlines().count("NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID="),
        )
        forbidden_placeholder = "<public WalletConnect " + "Cloud project ID>"
        self.assertNotIn(forbidden_placeholder, ENV_EXAMPLE)
        self.assertIn("browser-visible", ENV_EXAMPLE)
        self.assertIn("Leave empty to use injected browser wallets only", ENV_EXAMPLE)


if __name__ == "__main__":
    unittest.main()
