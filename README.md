# PayGenius AI

**Intelligent payments. Autonomous resolution—with guardrails.**

PayGenius AI is a merchant-focused payment investigation prototype. The authenticated workspace can create tenant-scoped investigation cases, look up a configured PayPal **sandbox** order, and request a read-only, evidence-cited AI analysis. It cannot issue refunds, retry payments, change orders, or access live PayPal accounts.

## What works

- **Merchant workspace:** generic OIDC Authorization Code + PKCE sign-in; API access tokens must contain `sub` and a trusted `tenant_id` claim.
- **Control plane:** ASP.NET Core 10 endpoints for tenant-scoped investigation create/list/detail and analysis; request validation, per-tenant rate limits, and database transactions.
- **Persistence:** PostgreSQL case, analysis/evidence, and audit-event tables are initialized by the API. Analysis is written together with its audit event.
- **PayPal:** server-side OAuth client-credentials access to one explicitly configured sandbox tenant, followed only by `GET /v2/checkout/orders/{id}`. The browser and AI service never receive PayPal credentials.
- **AI runtime:** internal-key-protected FastAPI endpoint calling Databricks Unity Gateway through the OpenAI SDK Responses API (`/ai-gateway/mlflow/v1/responses`). It receives only verified provider evidence from the API, must cite supplied evidence, and can recommend only read-only investigation or human escalation.
- **Agent playground:** `/agent-playground` offers an always-available scripted simulation and an optional Databricks tool-calling mode backed only by fictional payment fixtures. The allowlisted tools are read-only; they cannot access PayPal or execute payment operations.
- **Local infrastructure:** PostgreSQL and Redis Compose services bind to loopback; Redis is reserved for future coordination.

The public home dashboard remains a clearly labeled sample-data demo. Use **Secure workspace** to sign in and work with persisted cases.
The customer message is sent to the configured model provider for analysis. Confirm your organization is permitted to share that support data with that provider, and review its retention and privacy terms before use.

## Not included yet

- PayPal partner onboarding, per-merchant OAuth credential vaulting, webhooks, or live payment access. The current provider adapter intentionally supports one sandbox tenant only.
- Merchant self-service tenant provisioning, organization/role administration, or an identity-provider deployment. Connect an OIDC issuer that supplies the required API access-token claims.
- Customer-facing support widget, voice, or a full MCP/LangGraph agent.
- Refunds, payment retries, notification retries, approval execution, or any other financial mutation.
- Production secret management, key rotation, migrations/versioned schema rollout, retention controls, deployment infrastructure, and production observability.

Do not treat AI output as authoritative payment state. PayPal is the only evidence source in this increment; merchant order-system reconciliation is not implemented. Missing or conflicting evidence must be escalated.

## Configure local development

Requirements: Node.js 20.9+, .NET 10 SDK, Python 3.12+, and Docker Compose.

1. Copy `.env.example` to `.env`. Set the same long local-only PostgreSQL password in `POSTGRES_PASSWORD` and the connection string, then generate a random service key and put it in both `AI__ServiceKey` and `AI_SERVICE_KEY`. Set the OIDC and provider/model values described below. Keep `.env` private; it is ignored by Git.
2. Register a **public OIDC client** with Authorization Code + PKCE:
   - Redirect URI: `http://localhost:3000/auth/callback`
   - Post-logout URI: `http://localhost:3000/`
   - Add the API scope/audience expected by the provider.
   - Configure API access tokens with the expected audience, a stable `sub`, and a trusted `tenant_id`.
   - Set `Authentication__Authority` to the issuer URL, `Authentication__Audience` to the API audience, and the matching `NEXT_PUBLIC_OIDC_*` variables in `.env`.
3. Create a PayPal sandbox app for the test merchant. Set `PayPal__ClientId`, `PayPal__ClientSecret`, and `PayPal__SandboxTenantId`. The tenant ID must exactly match that tenant's trusted OIDC `tenant_id` claim. No live endpoint is available in this code.
4. Configure `DATABRICKS_HOST` (the HTTPS workspace origin) and `DATABRICKS_MODEL` in `.env`; the model defaults to `system.ai.gpt-oss-120b`. Save a **newly rotated** Databricks token securely:

   ```powershell
   .\scripts\set-databricks-token.ps1
   ```

   Enter it at the hidden prompt. It is saved in `secrets\databricks-token.dpapi`, encrypted with Windows DPAPI for your Windows user, and ignored by Git. Set a long random `AI_SERVICE_KEY`, matching `AI__ServiceKey` in the API. Never place provider tokens in `.env` or browser variables.
5. Start PostgreSQL and Redis:

   ```powershell
   docker compose up -d postgres redis
   ```

6. In each PowerShell terminal that starts a service, load the local environment:

   ```powershell
   . .\scripts\load-env.ps1
   ```

7. Start the API:

   ```powershell
   dotnet run --project api --urls http://localhost:8080
   ```

   Check `http://localhost:8080/health/live` and `/health/ready`. Readiness stays `503` until PostgreSQL and OIDC are configured. The first configured start creates the required tables.

8. Start the AI service in a separate terminal (load `.env` there too):

   ```powershell
   python -m venv ai-service\.venv
   .\ai-service\.venv\Scripts\Activate.ps1
   pip install -r ai-service\requirements.txt
   uvicorn app.main:app --app-dir ai-service --reload --port 8000
   ```

   Health endpoints are `http://localhost:8000/health/live` and `/health/ready`. Readiness reports Databricks Unity Gateway only when the workspace host, model, token, and internal service key are configured. The analysis endpoint is internal and requires `X-Service-Key`.

9. Start the web app in a third terminal (load `.env` before Next.js starts so its public OIDC/API settings are available):

   ```powershell
   . .\scripts\load-env.ps1
   cd web
   npm run dev
   ```

   Open `http://localhost:3000`, sign in, and go to **Secure workspace**. Create a case using a sandbox PayPal order ID. Analysis requires both the configured sandbox app and AI service. The AI service calls the configured Databricks model with Unity Gateway's Responses API.

   To try the agent demo, set `DEMO_AGENT_ENABLED=true` and `AI_SERVICE_URL=http://localhost:8000` in `.env`, then open `http://localhost:3000/agent-playground`. Simulation mode works without Databricks. Databricks AI mode requires the protected Python service, `DATABRICKS_TOKEN`, `DATABRICKS_HOST`, and a valid model permission. The Next.js proxy sends `AI_SERVICE_KEY` server-side only; do not expose it through a `NEXT_PUBLIC_*` variable.

The public Vercel frontend can run Simulation mode without any backend. Databricks AI mode additionally requires deploying the Python AI service to a reachable HTTPS host with `DEMO_AGENT_ENABLED=true`, then setting `AI_SERVICE_URL` and `AI_SERVICE_KEY` as server-side Vercel environment variables. Vercel does not host this Python service as part of the frontend deployment. The proxy applies a small per-instance request limit; use provider-side/network rate limiting for production deployments.

If OIDC, PayPal sandbox, or AI settings are absent, related functions return an explicit configuration error rather than sample or success-shaped data. The local Compose stack does not include an identity provider.

## API

All `/api` endpoints require a valid OIDC bearer access token with `sub` and `tenant_id` claims. Data access is scoped to the token tenant; the tenant is never accepted from the request body.

| Method | Route | Behavior |
| --- | --- | --- |
| `GET` | `/api/investigations?limit=50` | List the caller's cases (1–100 limit) |
| `POST` | `/api/investigations` | Create a case with `transactionReference` and `customerMessage` |
| `GET` | `/api/investigations/{id}` | Fetch a tenant-scoped case and its latest saved analysis, if any |
| `POST` | `/api/investigations/{id}/analyze` | Fetch the sandbox order, request evidence-grounded analysis, and persist the evidence/result/audit event |

Example create request:

```json
{
  "transactionReference": "5O190127TN364715T",
  "customerMessage": "My order is still pending."
}
```

Messages that appear to contain card numbers or security codes are rejected. Never submit card numbers, CVVs, passwords, or provider credentials.

## Validate

```powershell
npm --prefix web run lint
npm --prefix web run build
dotnet build api\PayNexus.Api.csproj
.\ai-service\.venv\Scripts\python.exe -m unittest discover -s ai-service\tests -v
```

Docker must be installed to validate the Compose configuration and run the local database. No live payment actions are implemented or enabled.

### Credential safety

The Databricks token previously pasted into chat should be revoked in Databricks and replaced before use. Do not copy it into a source file, chat, shell command, or `.env`. Run the secure-token script as the same Windows account that will start the AI service. Dot-source `scripts\load-env.ps1` in each service terminal; it loads local settings and decrypts the token into that terminal's process environment for child processes. Protect your Windows account and do not commit, upload, or share the `secrets` directory. The DPAPI file is encrypted at rest but is available to the same Windows user when loaded.
