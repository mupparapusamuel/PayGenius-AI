# PayNexus AI — Architecture and product boundaries

## Product scope

Initial users are merchants and their support teams. The product helps their customers resolve payment issues through a merchant-branded chat surface and gives operators a console for cases, evidence, and approvals. The first release is read-only investigation; expand autonomy only after the relevant authorization, policy, and audit controls exist.

## System context

```text
Customer widget / Merchant console (Next.js)
                    |
                    v
ASP.NET Core control plane ---- PostgreSQL (tenant-scoped records, audit)
        |           |
        |           +---------- Redis (ephemeral coordination only)
        |
        +---- Python agent runtime (narrow, typed tool interface)
        |
        +---- PayPal adapter (merchant OAuth, verified webhooks, API)
```

The control plane owns identity, tenant isolation, policy enforcement, provider credentials, and all financial mutations. The Python runtime owns reasoning and orchestration only. The model receives the minimum redacted context needed for a case and returns structured proposals, not authority.

## Trust boundaries and invariants

- Every request and stored record is scoped to an authenticated tenant; tenant identity is derived from trusted server-side identity claims, never from an untrusted request body.
- Provider OAuth credentials remain encrypted in a secret store and are available only to the API's PayPal adapter.
- Verify webhook signatures before processing; deduplicate events and make handlers safe to replay.
- The database/provider, not the LLM, is authoritative for payment state. Re-fetch current state immediately before any mutation.
- Every tool call, evidence item, policy decision, approval, and provider result is traceable in an append-only audit record.
- Mutations require server-side policy checks, idempotency keys, bounded retries, and explicit authorization. Refunds and other high-impact actions require step-up/customer authorization and configured approval.
- Never ask for or persist full card numbers, CVVs, passwords, or provider credentials in chat.
- Fail closed when identity, tenant, provider state, policy, or approval cannot be verified.

## Execution levels

| Level | Capability | Guardrail |
| --- | --- | --- |
| 1 — Investigate | Read transaction status, reconcile event/order references, explain verified evidence | Read-only credentials/scopes; cite provider and merchant-system evidence |
| 2 — Routine operation | Retry an eligible notification or other bounded reversible operation | Merchant policy, idempotency, rate limits, durable audit, observed outcome |
| 3 — Financial action | Refund or another high-impact/irreversible operation | Eligibility check, explicit authorization, configured approval, step-up verification, audit |

The agent never promotes itself between levels. Policy and authorization are evaluated by the control plane for every action.

## Initial service responsibilities

### Next.js web

- Merchant dashboard and case review/approval UI.
- Future merchant-branded customer widget.
- No provider secrets, trusted authorization decisions, or direct provider calls in browser code.

### ASP.NET Core control plane

- Authentication, tenant membership and role checks.
- Provider connection lifecycle, webhook verification, transaction data access.
- Case lifecycle, policy evaluation, authorization, idempotent action execution.
- Audit writing, API rate limiting, and the typed interface to the agent runtime.

### Python agent runtime

- Intent classification, workflow orchestration, and evidence-backed response drafting.
- Receives short-lived, tenant-scoped context from the control plane.
- Invokes only allowlisted typed tools exposed by the control plane; no raw SQL, arbitrary network access, or direct gateway credentials.

### PostgreSQL and Redis

- PostgreSQL is the durable source of truth for tenants, cases, policies, approvals, provider event IDs, idempotency keys, and audit records.
- Redis is disposable infrastructure for short-lived coordination and rate limits. A cache outage must not create duplicate financial actions.

## First release sequence

1. Authentication, tenant isolation, role model, and audit schema.
2. PayPal OAuth and verified webhook ingestion in sandbox; event replay and duplicate delivery tests.
3. Read-only transaction investigation tied to provider facts and merchant order status.
4. Operator review and escalation workflow.
5. Policy-gated routine actions with idempotency and fault-injection tests.
6. Explicitly approved financial actions only after legal, risk, and operations review.

## Operational requirements before production

Use managed identity/secret storage, TLS, encryption at rest, strict data retention, redaction, tenant-aware authorization tests, dependency scanning, structured logs with correlation IDs, metrics/traces, incident runbooks, and sandbox/contract tests for each provider API. Keep model version, prompt/config version, tool arguments, policy result, and evidence provenance in the audit trail without logging sensitive credentials or card data.
