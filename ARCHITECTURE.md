# PayNexus AI — Architecture and product boundaries

## Current release boundary

This increment provides a single sandbox-merchant vertical slice: OIDC-authenticated case creation, tenant-scoped PostgreSQL storage, PayPal sandbox order lookup, internal evidence-only AI analysis, and audit records. It is not a production multi-tenant payment integration. Real multi-merchant onboarding, per-tenant credential storage, webhook verification, approval controls, and live actions remain gated future work.

## System context

```text
Merchant browser (Next.js + OIDC PKCE)
                    |
                    | OIDC bearer access token
                    v
ASP.NET Core control plane ---- PostgreSQL
        |           |
        |           +---------- Redis (not used by current case flow)
        |
        +---- PayPal sandbox API (server-side credentials, one allowlisted tenant)
        |
        +---- Python analysis service (internal shared key, no payment credentials)
                    |
                    +---- Databricks Unity Gateway Responses API
```

## Trust boundaries and invariants

- The API validates issuer, audience, and token signature using OIDC discovery. API requests require a trusted `sub` and `tenant_id` claim; the API does not accept a tenant identifier from the caller.
- Every case lookup, insert, and update uses tenant-scoped predicates. Case creation and its audit event are committed in one database transaction. Analysis, provider evidence, case status, and its audit event are committed together.
- The current PayPal client uses the fixed sandbox API host and server-side client credentials. It is enabled for exactly the configured sandbox tenant. It only retrieves orders; no mutation endpoints or live host exist.
- The API sends only the order's status, intent, and creation timestamp plus the case message to the AI service. Provider credentials and access tokens never leave the API.
- The AI service is guarded by a shared internal key and validates that cited evidence IDs were actually supplied. It uses the OpenAI Python SDK with Databricks Unity Gateway's OpenAI-compatible Responses API and the configured `system.ai` model. The Databricks token is loaded from a per-user Windows DPAPI-encrypted file and is never sent to the browser. The service has no payment tools and is instructed to use only verified evidence, recommend only read-only next steps, and escalate insufficient or conflicting evidence.
- The database/provider, not the LLM, is authoritative. The AI response is a triage aid, not proof of settlement or merchant order delivery.
- Likely card numbers and security-code terms in support messages are rejected. Never submit or store full card numbers, CVVs, passwords, or provider secrets.
- OIDC and PostgreSQL are required for API tenant data. Missing provider/model settings cause explicit service errors. Production deployment must use HTTPS and a managed secret store.

## Current execution levels

| Level | Current support | Guardrail |
| --- | --- | --- |
| 1 — Investigate | Create/list cases; retrieve one PayPal sandbox order; summarize verified order facts | OIDC tenant scope; sandbox-only fixed host; model citations checked against evidence |
| 2 — Routine operation | Not implemented | No retry or notification mutation route exists |
| 3 — Financial action | Not implemented | No refund or other financial mutation route exists |

## Services

### Next.js web

- The public dashboard is sample-data-only and labeled as a demo.
- The separate merchant workspace uses a public OIDC Authorization Code + PKCE client and sends access tokens only to the configured API.
- No payment credentials or authorization secrets are included in browser code.

### ASP.NET Core control plane

- Validates OIDC access tokens and enforces a `tenant_id` claim and tenant-scoped database operations.
- Persists cases, provider evidence, analysis, and audit events in PostgreSQL.
- Retrieves PayPal sandbox orders and calls the internal AI analysis service.
- Enforces request size/content limits, rate limits, CORS origin restrictions, and read-only provider behavior.

### Python AI service

- Receives a bounded customer message and verified provider evidence only.
- Uses the OpenAI SDK Responses API at Databricks Unity Gateway's `/ai-gateway/mlflow/v1/responses` endpoint with the configured model.
- Rejects invalid model output and citations to evidence that was not provided.
- Does not hold gateway credentials, connect directly to payment APIs, or execute tools.

### PostgreSQL and Redis

- PostgreSQL is the source of truth for cases, analysis/evidence, and audit events. The API bootstraps the initial schema; a versioned migration system is still needed before production.
- Redis is loopback-only in the local Compose file and is not required by the current investigation flow.

## Remaining before production

1. Select/operate the OIDC identity provider, provision tenants/roles, and add security-focused authorization integration tests.
2. Replace the single sandbox tenant setting with PayPal partner merchant onboarding and a per-tenant encrypted credential vault; verify signed webhooks and deduplicate events.
3. Add a versioned schema migration/rollback process, encryption/key rotation, data retention and deletion controls.
4. Add merchant-system order evidence so the system can distinguish provider settlement from fulfillment/order-confirmation failures.
5. Add policy evaluation, approvals, idempotency, and fault-injection tests before any reversible operation.
6. Perform risk/legal review and step-up/customer authorization before any financial action.
7. Add deployment infrastructure, TLS, managed secrets, observability, incident response, and model/provider contract tests.

No live payment action should be enabled until these controls are in place and independently reviewed.
