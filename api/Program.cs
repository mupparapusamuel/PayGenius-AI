var builder = WebApplication.CreateBuilder(args);

var frontendOrigin = builder.Configuration["Frontend:Origin"] ?? "http://localhost:3000";
builder.Services.AddCors(options =>
{
    options.AddDefaultPolicy(policy =>
        policy.WithOrigins(frontendOrigin)
            .AllowAnyHeader()
            .AllowAnyMethod());
});

var app = builder.Build();

app.UseCors();

app.MapGet("/health/live", () => Results.Ok(new
{
    status = "healthy",
    service = "paynexus-api"
}));

app.MapGet("/health/ready", () => Results.Ok(new
{
    status = "ready",
    service = "paynexus-api",
    dependencies = new
    {
        database = "not-configured",
        cache = "not-configured",
        paymentProvider = "not-configured"
    }
}));

app.Run();
