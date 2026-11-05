using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;

public sealed class PayPalOrdersClient
{
    private static readonly HttpClient HttpClient = new()
    {
        Timeout = TimeSpan.FromSeconds(15)
    };
    private readonly string? _clientId;
    private readonly string? _clientSecret;
    private readonly string? _tenantId;
    private readonly SemaphoreSlim _tokenLock = new(1, 1);
    private string? _accessToken;
    private DateTimeOffset _tokenExpiresAt;

    public PayPalOrdersClient(IConfiguration configuration)
    {
        _clientId = configuration["PayPal:ClientId"];
        _clientSecret = configuration["PayPal:ClientSecret"];
        _tenantId = configuration["PayPal:SandboxTenantId"];
    }

    public bool IsConfigured =>
        !string.IsNullOrWhiteSpace(_clientId) &&
        !string.IsNullOrWhiteSpace(_clientSecret) &&
        !string.IsNullOrWhiteSpace(_tenantId);

    public bool IsEnabledForTenant(string tenantId) =>
        IsConfigured && string.Equals(_tenantId, tenantId, StringComparison.Ordinal);

    public async Task<PayPalOrderSnapshot> GetOrderAsync(
        string tenantId,
        string orderId,
        CancellationToken cancellationToken)
    {
        if (!IsEnabledForTenant(tenantId))
        {
            throw new InvalidOperationException("PayPal sandbox is not configured for this tenant.");
        }

        if (!System.Text.RegularExpressions.Regex.IsMatch(orderId, @"\A[A-Za-z0-9._-]{1,128}\z"))
        {
            throw new ArgumentException("The PayPal order reference has an invalid format.", nameof(orderId));
        }

        using var request = new HttpRequestMessage(
            HttpMethod.Get,
            $"https://api-m.sandbox.paypal.com/v2/checkout/orders/{Uri.EscapeDataString(orderId)}");
        request.Headers.Authorization = new AuthenticationHeaderValue(
            "Bearer",
            await GetAccessTokenAsync(cancellationToken));

        using var response = await HttpClient.SendAsync(request, cancellationToken);
        if (!response.IsSuccessStatusCode)
        {
            throw new PayPalProviderException((int)response.StatusCode);
        }

        using var document = await JsonDocument.ParseAsync(
            await response.Content.ReadAsStreamAsync(cancellationToken),
            cancellationToken: cancellationToken);
        var root = document.RootElement;
        if (root.ValueKind != JsonValueKind.Object)
        {
            throw new PayPalProviderException((int)response.StatusCode, "PayPal returned an invalid order.");
        }

        var id = ReadString(root, "id");
        var status = ReadString(root, "status");
        var intent = ReadString(root, "intent");
        var createTime = ReadString(root, "create_time");

        if (string.IsNullOrWhiteSpace(id) || string.IsNullOrWhiteSpace(status))
        {
            throw new PayPalProviderException((int)response.StatusCode, "PayPal returned an incomplete order.");
        }

        return new PayPalOrderSnapshot(id, status, intent, createTime);
    }

    private async Task<string> GetAccessTokenAsync(CancellationToken cancellationToken)
    {
        await _tokenLock.WaitAsync(cancellationToken);
        try
        {
            var cachedAccessToken = _accessToken;
            if (!string.IsNullOrWhiteSpace(cachedAccessToken) &&
                _tokenExpiresAt > DateTimeOffset.UtcNow)
            {
                return cachedAccessToken;
            }

            var basicCredentials = Convert.ToBase64String(
                Encoding.UTF8.GetBytes($"{_clientId}:{_clientSecret}"));
            using var request = new HttpRequestMessage(
                HttpMethod.Post,
                "https://api-m.sandbox.paypal.com/v1/oauth2/token");
            request.Headers.Authorization = new AuthenticationHeaderValue("Basic", basicCredentials);
            request.Content = new FormUrlEncodedContent(
                [new KeyValuePair<string, string>("grant_type", "client_credentials")]);

            using var response = await HttpClient.SendAsync(request, cancellationToken);
            if (!response.IsSuccessStatusCode)
            {
                throw new PayPalProviderException((int)response.StatusCode);
            }

            using var document = await JsonDocument.ParseAsync(
                await response.Content.ReadAsStreamAsync(cancellationToken),
                cancellationToken: cancellationToken);
            var root = document.RootElement;
            if (root.ValueKind != JsonValueKind.Object ||
                !root.TryGetProperty("access_token", out var tokenValue))
            {
                throw new PayPalProviderException((int)response.StatusCode, "PayPal returned no access token.");
            }

            var accessToken = tokenValue.GetString();
            if (string.IsNullOrWhiteSpace(accessToken))
            {
                throw new PayPalProviderException((int)response.StatusCode, "PayPal returned no access token.");
            }

            _accessToken = accessToken;
            var expiresIn = root.TryGetProperty("expires_in", out var expiryValue) &&
                expiryValue.TryGetInt32(out var parsedExpiry)
                ? parsedExpiry
                : 300;
            _tokenExpiresAt = DateTimeOffset.UtcNow.AddSeconds(Math.Max(0, expiresIn - 30));
            return accessToken;
        }
        finally
        {
            _tokenLock.Release();
        }
    }

    private static string? ReadString(JsonElement value, string propertyName) =>
        value.TryGetProperty(propertyName, out var property) &&
        property.ValueKind == JsonValueKind.String
            ? property.GetString()
            : null;
}

public sealed record PayPalOrderSnapshot(string Id, string Status, string? Intent, string? CreatedAt);

public sealed class PayPalProviderException(int statusCode, string? message = null)
    : Exception(message ?? $"PayPal returned HTTP {statusCode}.")
{
    public int StatusCode { get; } = statusCode;
}
