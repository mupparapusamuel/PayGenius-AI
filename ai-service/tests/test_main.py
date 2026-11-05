import os
import sys
import unittest
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
        with (
            patch.dict(os.environ, {"AI_SERVICE_KEY": self.service_key}, clear=False),
            patch("app.main.call_model", new=AsyncMock(return_value=result)),
        ):
            response = self.client.post(
                "/v1/investigations/analyze",
                headers={"X-Service-Key": self.service_key},
                json=self.request,
            )

        self.assertEqual(response.status_code, 502)

    def test_analysis_serializes_response_as_camel_case(self) -> None:
        result = main.Analysis(
            likely_cause="Order is approved",
            explanation="PayPal reports an approved order.",
            recommended_next_step="Verify the merchant's order status.",
            confidence=0.8,
            needs_human_review=False,
            evidence_ids=["provider-1"],
        )
        with (
            patch.dict(os.environ, {"AI_SERVICE_KEY": self.service_key}, clear=False),
            patch("app.main.call_model", new=AsyncMock(return_value=result)),
        ):
            response = self.client.post(
                "/v1/investigations/analyze",
                headers={"X-Service-Key": self.service_key},
                json=self.request,
            )

        self.assertEqual(response.status_code, 200)
        self.assertIn("likelyCause", response.json())
        self.assertIn("evidenceIds", response.json())

    def test_model_provider_rejects_non_tls_remote_urls(self) -> None:
        with (
            patch.dict(
                os.environ,
                {
                    "AI_SERVICE_KEY": self.service_key,
                    "OPENAI_API_KEY": "local-test-key",
                    "OPENAI_BASE_URL": "http://example.test/v1",
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


if __name__ == "__main__":
    unittest.main()
