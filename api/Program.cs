using System.Net.Http;
using System.Text.RegularExpressions;
using System.Threading.RateLimiting;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.RateLimiting;
using Npgsql;

var builder = WebApplication.CreateBuilder(args);
var webJsonOptions = new JsonSerializerOptions(JsonSerializerDefaults.Web);
var frontendOrigin = builder.Configuration["Frontend:Origin"] ?? "http://localhost:3000";
var oidcAuthority = builder.Configuration["Authentication:Authority"];
var oidcAudience = builder.Configuration["Authentication:Audience"];
var tenantClaim = builder.Configuration["Authentication:TenantClaim"] ?? "tenant_id";
var connectionString = builder.Configuration.GetConnectionString("Postgres");

if (string.IsNullOrWhiteSpace(oidcAuthority) != string.IsNullOrWhiteSpace(oidcAudience))
{
    throw new InvalidOperationException(
        "Configure both Authentication:Authority and Authentication:Audience to enable protected API routes.");
}

var oidcConfigured = !string.IsNullOrWhiteSpace(oidcAuthority);
var databaseConfigured = !string.IsNullOrWhiteSpace(connectionString);

builder.Services.AddCors(options =>
{
    options.AddDefaultPolicy(policy =>
        policy.WithOrigins(frontendOrigin)
            .AllowAnyHeader()
            .AllowAnyMethod());
});

if (oidcConfigured)
{
    builder.Services
        .AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
        .AddJwtBearer(options =>
        {
            options.Authority = oidcAuthority;
            options.Audience = oidcAudience;
            options.RequireHttpsMetadata = !builder.Environment.IsDevelopment();
            options.MapInboundClaims = false;
        });
    builder.Services.AddAuthorization();
}

builder.Services.AddRateLimiter(options =>
{
    options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
    options.AddPolicy("tenant-api", context =>
        RateLimitPartition.GetFixedWindowLimiter(
            context.User.FindFirst(tenantClaim)?.Value
                ?? context.Connection.RemoteIpAddress?.ToString()
                ?? "unknown",
            _ => new FixedWindowRateLimiterOptions
            {
                PermitLimit = 60,
                Window = TimeSpan.FromMinutes(1),
                QueueLimit = 0,
                AutoReplenishment = true
            }));
});

if (databaseConfigured)
{
    builder.Services.AddSingleton(_ => NpgsqlDataSource.Create(connectionString!));
}
builder.Services.AddSingleton<PayPalOrdersClient>();
builder.Services.AddSingleton<AiAnalysisClient>();

var app = builder.Build();
app.UseCors();

if (oidcConfigured)
{
    app.UseAuthentication();
    app.UseAuthorization();
}
app.UseRateLimiter();

app.MapGet("/health/live", () => Results.Ok(new
{
    status = "healthy",
    service = "paynexus-api"
}));

app.MapGet("/health/ready", async (IServiceProvider services, ILogger<Program> logger) =>
{
    var databaseReady = false;
    if (databaseConfigured)
    {
        try
        {
            var dataSource = services.GetRequiredService<NpgsqlDataSource>();
            await using var connection = await dataSource.OpenConnectionAsync();
            await using var command = new NpgsqlCommand("SELECT 1", connection);
            await command.ExecuteScalarAsync();
            databaseReady = true;
        }
        catch (NpgsqlException exception)
        {
            logger.LogWarning(exception, "Database readiness check failed.");
        }
    }

    var ready = databaseConfigured && databaseReady && oidcConfigured;
    return Results.Json(new
    {
        status = ready ? "ready" : "not-ready",
        service = "paynexus-api",
        dependencies = new
        {
            database = !databaseConfigured ? "not-configured" : databaseReady ? "ready" : "unavailable",
            authentication = oidcConfigured ? "configured" : "not-configured",
            paymentProvider = services.GetRequiredService<PayPalOrdersClient>().IsConfigured
                ? "sandbox-configured"
                : "not-configured",
            aiService = services.GetRequiredService<AiAnalysisClient>().IsConfigured
                ? "configured"
                : "not-configured"
        }
    }, statusCode: ready ? StatusCodes.Status200OK : StatusCodes.Status503ServiceUnavailable);
});

var api = app.MapGroup("/api");
if (!oidcConfigured || !databaseConfigured)
{
    static IResult NotConfigured() => Results.Problem(
        "The API requires an OIDC authority, audience, and PostgreSQL connection before tenant data is available.",
        statusCode: StatusCodes.Status503ServiceUnavailable);

    api.MapGet("/", NotConfigured);
    api.MapGet("/{**path}", NotConfigured);
    api.MapPost("/", NotConfigured);
    api.MapPost("/{**path}", NotConfigured);
}
else
{
    var dataSource = app.Services.GetRequiredService<NpgsqlDataSource>();
    await Database.InitializeAsync(dataSource);

    var protectedApi = api
        .RequireAuthorization()
        .RequireRateLimiting("tenant-api");

    protectedApi.AddEndpointFilter(async (context, next) =>
    {
        var user = context.HttpContext.User;
        var tenantId = user.FindFirst(tenantClaim)?.Value;
        var subject = user.FindFirst("sub")?.Value;
        if (string.IsNullOrWhiteSpace(tenantId) || tenantId.Length > 128 ||
            string.IsNullOrWhiteSpace(subject) || subject.Length > 256)
        {
            return Results.Forbid();
        }

        return await next(context);
    });

    protectedApi.MapGet("/investigations", async (
        HttpContext context,
        NpgsqlDataSource dataSource,
        int? limit) =>
    {
        var tenantId = context.User.FindFirst(tenantClaim)!.Value;
        var pageSize = Math.Clamp(limit ?? 50, 1, 100);
        var items = new List<InvestigationCase>();
        await using var connection = await dataSource.OpenConnectionAsync();
        await using var command = new NpgsqlCommand("""
            SELECT id, transaction_reference, customer_message, status, created_at
            FROM investigation_cases
            WHERE tenant_id = @tenant_id
            ORDER BY created_at DESC
            LIMIT @limit
            """, connection);
        command.Parameters.AddWithValue("tenant_id", tenantId);
        command.Parameters.AddWithValue("limit", pageSize);
        await using var reader = await command.ExecuteReaderAsync();
        while (await reader.ReadAsync())
        {
            items.Add(ReadCase(reader));
        }

        return Results.Ok(items);
    });

    protectedApi.MapGet("/investigations/{id:guid}", async (
        Guid id,
        HttpContext context,
        NpgsqlDataSource dataSource) =>
    {
        var tenantId = context.User.FindFirst(tenantClaim)!.Value;
        await using var connection = await dataSource.OpenConnectionAsync();
        await using var command = new NpgsqlCommand("""
            SELECT c.id, c.transaction_reference, c.customer_message, c.status, c.created_at,
                   a.provider_evidence::TEXT, a.analysis::TEXT
            FROM investigation_cases AS c
            LEFT JOIN LATERAL (
                SELECT provider_evidence, analysis
                FROM investigation_analyses
                WHERE investigation_id = c.id AND tenant_id = c.tenant_id
                ORDER BY created_at DESC
                LIMIT 1
            ) AS a ON TRUE
            WHERE c.tenant_id = @tenant_id AND c.id = @id
            """, connection);
        command.Parameters.AddWithValue("tenant_id", tenantId);
        command.Parameters.AddWithValue("id", id);
        await using var reader = await command.ExecuteReaderAsync();
        if (!await reader.ReadAsync())
        {
            return Results.NotFound();
        }

        var investigation = ReadCase(reader);
        JsonElement? providerEvidence = null;
        JsonElement? analysis = null;
        if (!await reader.IsDBNullAsync(5))
        {
            using var evidenceDocument = JsonDocument.Parse(reader.GetString(5));
            providerEvidence = evidenceDocument.RootElement.Clone();
        }
        if (!await reader.IsDBNullAsync(6))
        {
            using var analysisDocument = JsonDocument.Parse(reader.GetString(6));
            analysis = analysisDocument.RootElement.Clone();
        }
        return Results.Ok(new { investigation, providerEvidence, analysis });
    });

    protectedApi.MapPost("/investigations", async (
        CreateInvestigationRequest request,
        HttpContext context,
        NpgsqlDataSource dataSource) =>
    {
        if (string.IsNullOrWhiteSpace(request.TransactionReference) ||
            request.TransactionReference.Length > 128 ||
            !Regex.IsMatch(request.TransactionReference, @"\A[A-Za-z0-9._-]{1,128}\z") ||
            ContainsPaymentCardData(request.TransactionReference) ||
            string.IsNullOrWhiteSpace(request.CustomerMessage) ||
            request.CustomerMessage.Length > 2_000 ||
            ContainsPaymentCardData(request.CustomerMessage))
        {
            return Results.ValidationProblem(new Dictionary<string, string[]>
            {
                ["request"] =
                [
                    "Provide a transaction reference up to 128 characters and a support message up to 2,000 characters. Do not include card numbers or security codes."
                ]
            });
        }

        var tenantId = context.User.FindFirst(tenantClaim)!.Value;
        var subject = context.User.FindFirst("sub")!.Value;
        var id = Guid.NewGuid();
        var createdAt = DateTimeOffset.UtcNow;
        var investigation = new InvestigationCase(
            id,
            request.TransactionReference.Trim(),
            request.CustomerMessage.Trim(),
            "open",
            createdAt);

        await using var connection = await dataSource.OpenConnectionAsync();
        await using var transaction = await connection.BeginTransactionAsync();
        await using (var insertCase = new NpgsqlCommand("""
            INSERT INTO investigation_cases
                (id, tenant_id, transaction_reference, customer_message, status, created_at)
            VALUES (@id, @tenant_id, @transaction_reference, @customer_message, @status, @created_at)
            """, connection, transaction))
        {
            insertCase.Parameters.AddWithValue("id", id);
            insertCase.Parameters.AddWithValue("tenant_id", tenantId);
            insertCase.Parameters.AddWithValue("transaction_reference", investigation.TransactionReference);
            insertCase.Parameters.AddWithValue("customer_message", investigation.CustomerMessage);
            insertCase.Parameters.AddWithValue("status", investigation.Status);
            insertCase.Parameters.AddWithValue("created_at", createdAt);
            await insertCase.ExecuteNonQueryAsync();
        }

        await using (var insertAudit = new NpgsqlCommand("""
            INSERT INTO audit_events (id, tenant_id, actor_id, action, resource_id, created_at)
            VALUES (@id, @tenant_id, @actor_id, @action, @resource_id, @created_at)
            """, connection, transaction))
        {
            insertAudit.Parameters.AddWithValue("id", Guid.NewGuid());
            insertAudit.Parameters.AddWithValue("tenant_id", tenantId);
            insertAudit.Parameters.AddWithValue("actor_id", subject);
            insertAudit.Parameters.AddWithValue("action", "investigation.created");
            insertAudit.Parameters.AddWithValue("resource_id", id);
            insertAudit.Parameters.AddWithValue("created_at", createdAt);
            await insertAudit.ExecuteNonQueryAsync();
        }

        await transaction.CommitAsync();
        return Results.Created($"/api/investigations/{id}", investigation);
    }).WithMetadata(new RequestSizeLimitAttribute(16 * 1024));

    protectedApi.MapPost("/investigations/{id:guid}/analyze", async (
        Guid id,
        HttpContext context,
        NpgsqlDataSource dataSource,
        PayPalOrdersClient paypalClient,
        AiAnalysisClient aiClient,
        ILogger<Program> logger,
        CancellationToken cancellationToken) =>
    {
        var tenantId = context.User.FindFirst(tenantClaim)!.Value;
        var subject = context.User.FindFirst("sub")!.Value;
        InvestigationCase? investigation;

        await using (var connection = await dataSource.OpenConnectionAsync(cancellationToken))
        await using (var command = new NpgsqlCommand("""
            SELECT id, transaction_reference, customer_message, status, created_at
            FROM investigation_cases
            WHERE tenant_id = @tenant_id AND id = @id
            """, connection))
        {
            command.Parameters.AddWithValue("tenant_id", tenantId);
            command.Parameters.AddWithValue("id", id);
            await using var reader = await command.ExecuteReaderAsync(cancellationToken);
            investigation = await reader.ReadAsync(cancellationToken) ? ReadCase(reader) : null;
        }

        if (investigation is null)
        {
            return Results.NotFound();
        }

        if (!paypalClient.IsConfigured)
        {
            return Results.Problem(
                "PayPal sandbox credentials and the allowed tenant are not configured.",
                statusCode: StatusCodes.Status503ServiceUnavailable);
        }
        if (!paypalClient.IsEnabledForTenant(tenantId))
        {
            return Results.Forbid();
        }
        if (!aiClient.IsConfigured)
        {
            return Results.Problem(
                "The internal evidence-analysis service is not configured.",
                statusCode: StatusCodes.Status503ServiceUnavailable);
        }

        try
        {
            var order = await paypalClient.GetOrderAsync(
                tenantId,
                investigation.TransactionReference,
                cancellationToken);
            if (!string.Equals(order.Id, investigation.TransactionReference, StringComparison.Ordinal))
            {
                throw new JsonException("PayPal returned an order with a different reference.");
            }
            var analysis = await aiClient.AnalyzeAsync(investigation, order, cancellationToken);
            var analysisJson = JsonSerializer.Serialize(analysis, webJsonOptions);
            var providerEvidenceJson = JsonSerializer.Serialize(order, webJsonOptions);
            var updatedStatus = analysis.NeedsHumanReview ? "needs_review" : "investigated";
            var createdAt = DateTimeOffset.UtcNow;

            await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
            await using var transaction = await connection.BeginTransactionAsync(cancellationToken);
            await using (var saveAnalysis = new NpgsqlCommand("""
                INSERT INTO investigation_analyses
                    (id, investigation_id, tenant_id, provider_evidence, analysis, created_at)
                VALUES (@id, @investigation_id, @tenant_id, @provider_evidence, @analysis, @created_at)
                """, connection, transaction))
            {
                saveAnalysis.Parameters.AddWithValue("id", Guid.NewGuid());
                saveAnalysis.Parameters.AddWithValue("investigation_id", id);
                saveAnalysis.Parameters.AddWithValue("tenant_id", tenantId);
                saveAnalysis.Parameters.AddWithValue("provider_evidence", NpgsqlTypes.NpgsqlDbType.Jsonb, providerEvidenceJson);
                saveAnalysis.Parameters.AddWithValue("analysis", NpgsqlTypes.NpgsqlDbType.Jsonb, analysisJson);
                saveAnalysis.Parameters.AddWithValue("created_at", createdAt);
                await saveAnalysis.ExecuteNonQueryAsync(cancellationToken);
            }

            await using (var updateCase = new NpgsqlCommand("""
                UPDATE investigation_cases SET status = @status
                WHERE tenant_id = @tenant_id AND id = @id
                """, connection, transaction))
            {
                updateCase.Parameters.AddWithValue("status", updatedStatus);
                updateCase.Parameters.AddWithValue("tenant_id", tenantId);
                updateCase.Parameters.AddWithValue("id", id);
                await updateCase.ExecuteNonQueryAsync(cancellationToken);
            }

            await using (var audit = new NpgsqlCommand("""
                INSERT INTO audit_events (id, tenant_id, actor_id, action, resource_id, created_at)
                VALUES (@id, @tenant_id, @actor_id, @action, @resource_id, @created_at)
                """, connection, transaction))
            {
                audit.Parameters.AddWithValue("id", Guid.NewGuid());
                audit.Parameters.AddWithValue("tenant_id", tenantId);
                audit.Parameters.AddWithValue("actor_id", subject);
                audit.Parameters.AddWithValue("action", "investigation.analyzed");
                audit.Parameters.AddWithValue("resource_id", id);
                audit.Parameters.AddWithValue("created_at", createdAt);
                await audit.ExecuteNonQueryAsync(cancellationToken);
            }

            await transaction.CommitAsync(cancellationToken);
            return Results.Ok(new { investigationId = id, status = updatedStatus, providerEvidence = order, analysis });
        }
        catch (PayPalProviderException exception)
        {
            logger.LogWarning("PayPal sandbox request failed with status {StatusCode}.", exception.StatusCode);
            if (exception.StatusCode == StatusCodes.Status404NotFound)
            {
                return Results.NotFound("The PayPal sandbox order was not found or is not accessible.");
            }

            return Results.Problem(
                "The PayPal sandbox could not verify this order.",
                statusCode: StatusCodes.Status502BadGateway);
        }
        catch (AiServiceException exception)
        {
            logger.LogWarning(exception, "AI analysis failed for investigation {InvestigationId}.", id);
            return Results.Problem(
                "Evidence was retrieved, but the analysis service could not complete the request.",
                statusCode: exception.StatusCode == StatusCodes.Status504GatewayTimeout
                    ? StatusCodes.Status504GatewayTimeout
                    : StatusCodes.Status502BadGateway);
        }
        catch (TaskCanceledException exception) when (!cancellationToken.IsCancellationRequested)
        {
            logger.LogWarning(exception, "PayPal sandbox request timed out.");
            return Results.Problem(
                "The PayPal sandbox request timed out.",
                statusCode: StatusCodes.Status504GatewayTimeout);
        }
        catch (HttpRequestException exception)
        {
            logger.LogWarning(exception, "PayPal sandbox request was unavailable.");
            return Results.Problem(
                "The PayPal sandbox is temporarily unavailable.",
                statusCode: StatusCodes.Status502BadGateway);
        }
        catch (JsonException exception)
        {
            logger.LogWarning(exception, "A payment integration returned an invalid response.");
            return Results.Problem(
                "A payment integration returned an invalid response.",
                statusCode: StatusCodes.Status502BadGateway);
        }
    });
}

app.Run();

static InvestigationCase ReadCase(NpgsqlDataReader reader) => new(
    reader.GetGuid(0),
    reader.GetString(1),
    reader.GetString(2),
    reader.GetString(3),
    reader.GetFieldValue<DateTimeOffset>(4));

static bool ContainsPaymentCardData(string value) =>
    Regex.IsMatch(value, @"(?<!\d)(?:\d[ -]?){13,19}(?!\d)") ||
    Regex.IsMatch(value, @"\b(?:cvv|cvc|security code)\b", RegexOptions.IgnoreCase);

public sealed record CreateInvestigationRequest(string TransactionReference, string CustomerMessage);

public sealed record InvestigationCase(
    Guid Id,
    string TransactionReference,
    string CustomerMessage,
    string Status,
    DateTimeOffset CreatedAt);

public partial class Program;

internal static class Database
{
    internal static async Task InitializeAsync(NpgsqlDataSource dataSource)
    {
        await using var connection = await dataSource.OpenConnectionAsync();
        await using var command = new NpgsqlCommand("""
            CREATE TABLE IF NOT EXISTS investigation_cases (
                id UUID PRIMARY KEY,
                tenant_id TEXT NOT NULL,
                transaction_reference TEXT NOT NULL,
                customer_message TEXT NOT NULL,
                status TEXT NOT NULL,
                created_at TIMESTAMPTZ NOT NULL
            );
            CREATE INDEX IF NOT EXISTS ix_investigation_cases_tenant_created
                ON investigation_cases (tenant_id, created_at DESC);

            CREATE TABLE IF NOT EXISTS investigation_analyses (
                id UUID PRIMARY KEY,
                investigation_id UUID NOT NULL REFERENCES investigation_cases (id),
                tenant_id TEXT NOT NULL,
                provider_evidence JSONB NOT NULL,
                analysis JSONB NOT NULL,
                created_at TIMESTAMPTZ NOT NULL
            );
            CREATE INDEX IF NOT EXISTS ix_investigation_analyses_tenant_created
                ON investigation_analyses (tenant_id, created_at DESC);
            CREATE INDEX IF NOT EXISTS ix_investigation_analyses_case_created
                ON investigation_analyses (investigation_id, created_at DESC);

            CREATE TABLE IF NOT EXISTS audit_events (
                id UUID PRIMARY KEY,
                tenant_id TEXT NOT NULL,
                actor_id TEXT NOT NULL,
                action TEXT NOT NULL,
                resource_id UUID NOT NULL,
                created_at TIMESTAMPTZ NOT NULL
            );
            CREATE INDEX IF NOT EXISTS ix_audit_events_tenant_created
                ON audit_events (tenant_id, created_at DESC);
            """, connection);
        await command.ExecuteNonQueryAsync();
    }
}
