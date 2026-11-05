import os
import sys
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from app import main


class InvestigationAnalysisTests(unittest.TestCase):
    service_key = "test-service-key-with-at-least-thirty-two-characters"

    def setUp(self) -> None:
        self.client = TestClient(main.app)
        self.request = {
            "transaction_reference": "ORDER-123",
            "customer_message": "My order is still pending.",
            "evidence": [
                {
                    "evidence_id": "provider-1",
                    "source": "paypal",
                    "summary": "Provider reports the order is approved.",
                }
            ],
        }

    def model_client(self, result: main.Analysis) -> AsyncMock:
        client = AsyncMock()
        client.__aenter__.return_value = client
        client.__aexit__.return_value = None
        client.responses.create = AsyncMock(
            return_value=SimpleNamespace(output_text=result.model_dump_json())
        )
        return client

    def databricks_environment(self) -> dict[str, str]:
        return {
            "AI_SERVICE_KEY": self.service_key,
            "DATABRICKS_TOKEN": "test-databricks-token-with-more-than-thirty-two-characters",
            "DATABRICKS_HOST": "https://workspace.example.databricks.com",
            "DATABRICKS_MODEL": "system.ai.gpt-oss-120b",
        }

    def test_analysis_requires_internal_service_key(self) -> None:
        with patch.dict(os.environ, {"AI_SERVICE_KEY": self.service_key}, clear=False):
            response = self.client.post("/v1/investigations/analyze", json=self.request)

        self.assertEqual(response.status_code, 401)

    def test_analysis_rejects_weak_service_key_configuration(self) -> None:
        with patch.dict(os.environ, {"AI_SERVICE_KEY": "weak"}, clear=False):
            response = self.client.post(
                "/v1/investigations/analyze",
                headers={"X-Service-Key": "weak"},
                json=self.request,
            )

        self.assertEqual(response.status_code, 503)

    def test_analysis_requires_evidence(self) -> None:
        with patch.dict(os.environ, {"AI_SERVICE_KEY": self.service_key}, clear=False):
            response = self.client.post(
                "/v1/investigations/analyze",
                headers={"X-Service-Key": self.service_key},
                json={**self.request, "evidence": []},
            )

        self.assertEqual(response.status_code, 422)

    def test_analysis_rejects_unknown_evidence_citations(self) -> None:
        result = main.Analysis(
            likely_cause="Unknown",
            explanation="The evidence is insufficient.",
            recommended_next_step="Escalate to a human reviewer.",
            confidence=0.1,
            needs_human_review=True,
            evidence_ids=["not-provided"],
        )
        fake_client = self.model_client(result)
        with (
            patch.dict(os.environ, self.databricks_environment(), clear=False),
            patch("app.main.AsyncOpenAI", return_value=fake_client) as sdk_client,
        ):
            response = self.client.post(
                "/v1/investigations/analyze",
                headers={"X-Service-Key": self.service_key},
                json=self.request,
            )

        self.assertEqual(response.status_code, 502)
        sdk_client.assert_called_once()
        fake_client.responses.create.assert_awaited_once()

    def test_analysis_uses_databricks_responses_api_and_serializes_camel_case(self) -> None:
        result = main.Analysis(
            likely_cause="Order is approved",
            explanation="PayPal reports an approved order.",
            recommended_next_step="Verify the merchant's order status.",
            confidence=0.8,
            needs_human_review=False,
            evidence_ids=["provider-1"],
        )
        fake_client = self.model_client(result)
        with (
            patch.dict(os.environ, self.databricks_environment(), clear=False),
            patch("app.main.AsyncOpenAI", return_value=fake_client) as sdk_client,
        ):
            response = self.client.post(
                "/v1/investigations/analyze",
                headers={"X-Service-Key": self.service_key},
                json=self.request,
            )

        self.assertEqual(response.status_code, 200)
        self.assertIn("likelyCause", response.json())
        self.assertIn("evidenceIds", response.json())
        sdk_client.assert_called_once_with(
            api_key=self.databricks_environment()["DATABRICKS_TOKEN"],
            base_url="https://workspace.example.databricks.com/ai-gateway/mlflow/v1",
            timeout=20.0,
            max_retries=1,
        )
        call = fake_client.responses.create.await_args.kwargs
        self.assertEqual(call["model"], "system.ai.gpt-oss-120b")
        self.assertEqual(call["max_output_tokens"], 600)
        self.assertEqual([item["role"] for item in call["input"]], ["system", "user"])

    def test_databricks_workspace_must_be_https_origin(self) -> None:
        with (
            patch.dict(
                os.environ,
                {
                    **self.databricks_environment(),
                    "DATABRICKS_HOST": "http://example.test/v1",
                },
                clear=False,
            ),
        ):
            response = self.client.post(
                "/v1/investigations/analyze",
                headers={"X-Service-Key": self.service_key},
                json=self.request,
            )

        self.assertEqual(response.status_code, 503)

    def test_health_is_available_without_payment_tools(self) -> None:
        response = self.client.get("/health/live")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["service"], "paynexus-ai")
        self.assertEqual(main.ready()["payment_tools"], "disabled")

    def test_readiness_confirms_databricks_without_exposing_credentials(self) -> None:
        settings = self.databricks_environment()
        with patch.dict(os.environ, settings, clear=False):
            readiness = main.ready()

        self.assertEqual(readiness["status"], "ready")
        self.assertEqual(readiness["model_provider"], "databricks-unity-gateway")
        self.assertNotIn(settings["DATABRICKS_TOKEN"], str(readiness))
        self.assertNotIn(settings["AI_SERVICE_KEY"], str(readiness))


if __name__ == "__main__":
    unittest.main()
