from fastapi import FastAPI

app = FastAPI(
    title="PayNexus AI Service",
    description="Isolated agent runtime. Payment tools are intentionally not enabled yet.",
    version="0.1.0",
)


@app.get("/health/live")
def live() -> dict[str, str]:
    return {"status": "healthy", "service": "paynexus-ai"}


@app.get("/health/ready")
def ready() -> dict[str, str]:
    return {
        "status": "ready",
        "service": "paynexus-ai",
        "model_provider": "not-configured",
        "payment_tools": "disabled",
    }
