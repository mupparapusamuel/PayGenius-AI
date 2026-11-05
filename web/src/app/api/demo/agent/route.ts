import { NextResponse, type NextRequest } from "next/server";

type RateWindow = { startedAt: number; count: number };

const windows = new Map<string, RateWindow>();
const windowMs = 60_000;
const limitPerWindow = 8;

function isRateLimited(request: NextRequest) {
  const now = Date.now();
  for (const [key, window] of windows) {
    if (now - window.startedAt >= windowMs) windows.delete(key);
  }

  const clientIp = request.headers.get("x-real-ip") ?? "unknown";
  const rateKey = windows.has(clientIp) || windows.size < 1_000 ? clientIp : "overflow";
  const window = windows.get(rateKey);
  if (!window || now - window.startedAt >= windowMs) {
    windows.set(rateKey, { startedAt: now, count: 1 });
    return false;
  }
  if (window.count >= limitPerWindow) return true;
  window.count += 1;
  return false;
}

export async function POST(request: NextRequest) {
  if (isRateLimited(request)) {
    return NextResponse.json(
      { detail: "Demo rate limit reached. Try again in a minute." },
      { status: 429 },
    );
  }

  const serviceUrl = process.env.AI_SERVICE_URL?.replace(/\/+$/, "");
  const serviceKey = process.env.AI_SERVICE_KEY;
  if (!serviceUrl || !serviceKey || serviceKey.length < 32) {
    return NextResponse.json(
      { detail: "Databricks demo is not connected. Use simulation mode or configure the server-side AI service." },
      { status: 503 },
    );
  }
  let parsedServiceUrl: URL;
  try {
    parsedServiceUrl = new URL(serviceUrl);
  } catch {
    return NextResponse.json(
      { detail: "AI_SERVICE_URL must be an absolute HTTPS URL." },
      { status: 503 },
    );
  }
  const localHost = ["localhost", "127.0.0.1", "[::1]"].includes(parsedServiceUrl.hostname);
  if (
    (parsedServiceUrl.protocol !== "https:" && !(localHost && parsedServiceUrl.protocol === "http:"))
    || parsedServiceUrl.username
    || parsedServiceUrl.password
    || parsedServiceUrl.pathname !== "/"
    || parsedServiceUrl.search
    || parsedServiceUrl.hash
  ) {
    return NextResponse.json(
      { detail: "AI_SERVICE_URL must be an HTTPS origin (HTTP is allowed only for localhost)." },
      { status: 503 },
    );
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ detail: "Request body must be valid JSON." }, { status: 400 });
  }

  if (
    typeof payload !== "object"
    || payload === null
    || !("message" in payload)
    || typeof payload.message !== "string"
    || payload.message.trim().length < 1
    || payload.message.length > 500
  ) {
    return NextResponse.json(
      { detail: "Enter a demo question between 1 and 500 characters." },
      { status: 400 },
    );
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch(`${serviceUrl}/v1/demo/agent`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Service-Key": serviceKey,
      },
      body: JSON.stringify({ message: payload.message }),
      cache: "no-store",
      signal: controller.signal,
    });
    const result = await response.json().catch(() => null) as {
      detail?: string;
      reply?: string;
      tool_trace?: unknown[];
      sample_data?: boolean;
      model?: string;
    } | null;
    if (!response.ok) {
      return NextResponse.json(
        { detail: result?.detail ?? "Databricks demo request failed." },
        { status: response.status },
      );
    }
    if (
      typeof result?.reply !== "string"
      || !Array.isArray(result.tool_trace)
      || result.sample_data !== true
    ) {
      return NextResponse.json(
        { detail: "The Databricks demo service returned an invalid response." },
        { status: 502 },
      );
    }

    return NextResponse.json({
      reply: result.reply,
      toolTrace: result.tool_trace,
      sampleData: result.sample_data,
      model: result?.model,
      mode: "databricks",
    });
  } catch {
    return NextResponse.json(
      { detail: "Could not reach the Databricks demo service. Check the server-side AI_SERVICE_URL." },
      { status: 502 },
    );
  } finally {
    clearTimeout(timeout);
  }
}
