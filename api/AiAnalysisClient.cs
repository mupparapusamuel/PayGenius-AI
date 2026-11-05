using System.Net.Http.Json;
using System.Text.Json;

public sealed class AiAnalysisClient
{
    private static readonly HttpClient HttpClient = new()
    {
        Timeout = TimeSpan.FromSeconds(25)
    };

    private readonly string? _serviceUrl;
    private readonly string? _serviceKey;

    public AiAnalysisClient(IConfiguration configuration)
    {
        _serviceUrl = configuration["AI:ServiceUrl"];
        _serviceKey = configuration["AI:ServiceKey"];
    }

    public bool IsConfigured =>
        Uri.TryCreate(_serviceUrl, UriKind.Absolute, out var serviceUri) &&
        (serviceUri.Scheme == Uri.UriSchemeHttps ||
            (serviceUri.IsLoopback && serviceUri.Scheme == Uri.UriSchemeHttp)) &&
        !string.IsNullOrWhiteSpace(_serviceKey) &&
        _serviceKey.Length >= 32;

    public async Task<InvestigationAnalysis> AnalyzeAsync(
        InvestigationCase investigation,
        PayPalOrderSnapshot order,
        CancellationToken cancellationToken)
    {
        if (!IsConfigured)
        {
            throw new InvalidOperationException("The internal AI service is not configured.");
        }

        var evidence = new[]
        {
            new
            {
                evidence_id = "paypal-order",
                source = "paypal_sandbox",
                summary = $"PayPal order {order.Id} has status {order.Status}; " +
                    $"intent={order.Intent ?? "not provided"}; " +
                    $"created_at={order.CreatedAt ?? "not provided"}."
            }
        };
        var payload = new
        {
            transaction_reference = investigation.TransactionReference,
            customer_message = investigation.CustomerMessage,
            evidence
        };
        using var request = new HttpRequestMessage(
            HttpMethod.Post,
            new Uri(new Uri(_serviceUrl!.TrimEnd('/') + "/"), "v1/investigations/analyze"));
        request.Headers.Add("X-Service-Key", _serviceKey);
        request.Content = JsonContent.Create(payload);

        try
        {
            using var response = await HttpClient.SendAsync(request, cancellationToken);
            if (!response.IsSuccessStatusCode)
            {
                throw new AiServiceException((int)response.StatusCode);
            }

            var analysis = await response.Content.ReadFromJsonAsync<InvestigationAnalysis>(
                cancellationToken: cancellationToken);
            return analysis ?? throw new AiServiceException(502);
        }
        catch (TaskCanceledException exception) when (!cancellationToken.IsCancellationRequested)
        {
            throw new AiServiceException(504, exception);
        }
        catch (HttpRequestException exception)
        {
            throw new AiServiceException(502, exception);
        }
        catch (JsonException exception)
        {
            throw new AiServiceException(502, exception);
        }
    }
}

public sealed record InvestigationAnalysis(
    string LikelyCause,
    string Explanation,
    string RecommendedNextStep,
    double Confidence,
    bool NeedsHumanReview,
    IReadOnlyList<string> EvidenceIds);

public sealed class AiServiceException(int statusCode, Exception? innerException = null)
    : Exception($"The AI service returned or caused HTTP {statusCode}.", innerException)
{
    public int StatusCode { get; } = statusCode;
}
