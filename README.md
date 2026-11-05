# PayNexus AI

**Intelligent payments. Autonomous resolution—with guardrails.**

PayNexus AI is a merchant-focused fintech SaaS concept for investigating payment support cases and automating only explicitly policy-approved resolutions. This repository is the foundation and interactive dashboard prototype; it does not connect to live payment accounts or perform financial actions.

## Architecture decision

Start with a modular, API-first platform for businesses that connect their own payment providers and support their customers. Use hybrid autonomy: the system may investigate using verified, read-only data; routine reversible operations can be enabled by merchant policy; refunds and other high-impact actions require explicit authorization and approval. Complex, ambiguous, or suspicious cases are escalated.

| Layer | Decision | Responsibility |
| --- | --- | --- |
| Web app | Next.js + TypeScript | Merchant operations console and future embeddable customer support UI |
| Control plane | ASP.NET Core 10 | Tenant boundary, identity, policy evaluation, provider/webhook adapters, audit records, API |
| Agent runtime | Python FastAPI | Isolated orchestration and model/tool execution; no direct payment credentials |
| Persistence | PostgreSQL | Tenant-scoped payment references, cases, policies, approvals, and append-only audit events |
| Cache / job coordination | Redis | Short-lived state, rate limiting, and asynchronous work coordination; never the source of financial truth |
| Provider | PayPal first | Merchant-authorized OAuth connection, verified webhooks, idempotent API operations |
| Model integration | Provider-neutral adapter | Structured tool calls with schema validation, policy checks, and traceable evidence |

The .NET API is the security and financial-action boundary. The agent service must request actions from it; it must never receive provider secrets or execute payment mutations directly. All reads and actions must be tenant-scoped and audited. Verify provider signatures and transaction state server-side; never trust model output, browser claims, or webhook payloads without verification.

## Repository status

Included now:

- Responsive merchant dashboard prototype with clearly labeled sample data.
- .NET and Python service health endpoints.
- Local PostgreSQL and Redis development dependencies.
- Architecture and safety decisions for the first product increment.

Not implemented or connected yet:

- Authentication, tenant provisioning, database migrations, or durable application endpoints.
- PayPal OAuth, webhooks, live transaction reads, refunds, or retries.
- LLM provider, LangGraph orchestration, MCP tools, or voice support.

The sample dashboard is not backed by a payment provider and must not be used to make operational decisions.

## Run locally

Requirements: Node.js 20.9+, .NET 10 SDK, Python 3.12+, and Docker Compose (only for PostgreSQL/Redis).

1. Copy `.env.example` to `.env` and set a local-only database password.
2. Start local dependencies:

   ```powershell
   docker compose up -d postgres redis
   ```

3. Start the API:

   ```powershell
   dotnet run --project api
   ```

   The API listens on `http://localhost:5000` or the port printed by `dotnet run`. Check `/health/live` and `/health/ready`.

4. Start the isolated AI service in a separate terminal:

   ```powershell
   python -m venv ai-service/.venv
   .\ai-service\.venv\Scripts\Activate.ps1
   pip install -r ai-service/requirements.txt
   uvicorn app.main:app --app-dir ai-service --reload --port 8000
   ```

   Check `http://localhost:8000/health/live` and `/health/ready`. Agent tools are disabled.

5. Start the web app:

   ```powershell
   cd web
   npm run dev
   ```

   Open `http://localhost:3000`.

## First production milestones

1. Establish authentication and tenant isolation; add authorization tests before provider data is introduced.
2. Add PostgreSQL schema/migrations, secret management, and append-only audit events.
3. Add PayPal merchant OAuth and signed webhook ingestion; verify events against the provider and deduplicate by provider event ID.
4. Ship read-only transaction investigation with evidence citations and explicit escalation for missing or inconsistent state.
5. Add policy evaluation and approval workflows; only then implement idempotent, reversible actions.
6. Add model orchestration behind typed tools, human-review thresholds, rate limits, observability, and adversarial testing.

No live credentials belong in `.env`, source control, model prompts, or browser code. Use a secret manager in deployed environments. Do not collect or store card numbers or CVVs.
