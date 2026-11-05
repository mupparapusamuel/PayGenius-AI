"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";

type DemoPayment = {
  reference: string;
  customer: string;
  amount: number;
  currency: string;
  status: string;
  issue: string;
};

type ToolCall = {
  tool: string;
  result: unknown;
};

type Message = {
  role: "user" | "assistant";
  content: string;
  mode?: "simulation" | "databricks";
  model?: string;
  tools?: ToolCall[];
};

const samplePayments: DemoPayment[] = [
  { reference: "DEMO-1001", customer: "Maya Chen", amount: 84.5, currency: "USD", status: "captured", issue: "Order confirmation is pending" },
  { reference: "DEMO-1002", customer: "Maya Chen", amount: 84.5, currency: "USD", status: "captured", issue: "Possible duplicate payment" },
  { reference: "DEMO-1003", customer: "Liam Garcia", amount: 29, currency: "USD", status: "failed", issue: "Provider declined the payment" },
  { reference: "DEMO-1004", customer: "Sophie Turner", amount: 120, currency: "USD", status: "pending", issue: "Waiting for provider confirmation" },
  { reference: "DEMO-1005", customer: "Aiden Patel", amount: 48.5, currency: "USD", status: "captured", issue: "Receipt requested" },
];

const suggestions = [
  "Summarize today's sample payments",
  "Find possible duplicate payments",
  "What happened with DEMO-1003?",
];

function simulateTools(message: string): Pick<Message, "content" | "tools"> {
  const question = message.toLowerCase();
  let tools: ToolCall[];

  if (question.includes("duplicate")) {
    const duplicates = samplePayments.filter((payment) => payment.customer === "Maya Chen");
    tools = [{ tool: "find_demo_duplicates", result: [{ sample_data: true, payments: duplicates }] }];
    return {
      content: "I found a possible duplicate in the fictional sample set: Maya Chen has two captured payments of $84.50 (DEMO-1001 and DEMO-1002, one minute apart). This is only a demo match—not proof of a real duplicate. No refund or other action was taken.",
      tools,
    };
  }

  const reference = message.match(/\bDEMO-\d{4}\b/i)?.[0].toUpperCase();
  if (reference) {
    const payment = samplePayments.find((item) => item.reference === reference);
    tools = [{
      tool: "get_demo_payment",
      result: payment ? { sample_data: true, ...payment } : { sample_data: true, found: false },
    }];
    return {
      content: payment
        ? `${reference} is a fictional ${payment.status} payment for ${payment.customer} (${formatAmount(payment.amount, payment.currency)}). The sample issue is: ${payment.issue}. This is generated demo data; no real payment was checked or changed.`
        : `I couldn't find ${reference} in the fictional sample records. No real payment was queried.`,
      tools,
    };
  }

  const onlyFailed = question.includes("fail");
  const result = onlyFailed ? samplePayments.filter((item) => item.status === "failed") : samplePayments;
  tools = [{ tool: "list_demo_payments", result }];
  const capturedTotal = samplePayments
    .filter((item) => item.status === "captured")
    .reduce((sum, item) => sum + item.amount, 0);
  tools.push({
    tool: "get_demo_payment_summary",
    result: {
      sample_data: true,
      payment_count: samplePayments.length,
      captured_total_usd: Number(capturedTotal.toFixed(2)),
      status_counts: {
        captured: samplePayments.filter((item) => item.status === "captured").length,
        failed: samplePayments.filter((item) => item.status === "failed").length,
        pending: samplePayments.filter((item) => item.status === "pending").length,
      },
    },
  });
  return {
    content: onlyFailed
      ? "There is one failed payment in the fictional sample data: DEMO-1003 for Liam Garcia ($29.00). The sample reports a provider decline. No retry was attempted."
      : `The synthetic dataset contains ${samplePayments.length} payments: 3 captured, 1 failed, and 1 pending. Captured total is ${formatAmount(capturedTotal, "USD")}. No real payment data was accessed.`,
    tools,
  };
}

function formatAmount(amount: number, currency: string) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(amount);
}

export default function AgentPlayground() {
  const [mode, setMode] = useState<"simulation" | "databricks">("simulation");
  const [message, setMessage] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const prompt = message.trim();
    if (!prompt || busy) return;

    setMessage("");
    setError("");
    setMessages((current) => [...current, { role: "user", content: prompt }]);
    setBusy(true);
    try {
      if (mode === "simulation") {
        const result = simulateTools(prompt);
        setMessages((current) => [...current, { role: "assistant", ...result, mode: "simulation" }]);
        return;
      }

      const response = await fetch("/api/demo/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: prompt }),
      });
      const result = await response.json() as {
        detail?: string;
        reply?: string;
        toolTrace?: ToolCall[];
        sampleData?: boolean;
        model?: string;
      };
      if (!response.ok) throw new Error(result.detail ?? "Databricks request failed.");
      setMessages((current) => [...current, {
        role: "assistant",
        content: result.reply ?? "The agent returned no text.",
        mode: "databricks",
        model: result.model,
        tools: result.toolTrace ?? [],
      }]);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "The agent request failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="agent-playground">
      <header className="playground-header">
        <Link className="brand" href="/">
          <span className="brand-mark"><span /></span>
          <span>paynexus<span className="brand-ai">.ai</span></span>
        </Link>
        <Link className="back-link" href="/">← Back to dashboard</Link>
      </header>

      <div className="playground-content">
        <div className="playground-title">
          <p className="eyebrow">INTERACTIVE DEMO · SYNTHETIC DATA ONLY</p>
          <h1>Agent playground</h1>
          <p>Try payment support prompts and inspect the read-only tools an agent can call.</p>
        </div>

        <div className="playground-safety">
          <span>i</span>
          <p><strong>Simulation uses fictional payments.</strong> No real customer, provider, or account is accessed. Tools cannot issue refunds, retry payments, or change data. Databricks mode runs only when a server-side AI service is configured.</p>
        </div>

        <section className="playground-card">
          <div className="playground-toolbar">
            <div className="mode-toggle" role="group" aria-label="Agent mode">
              <button className={mode === "simulation" ? "mode-active" : ""} onClick={() => setMode("simulation")}>Simulation</button>
              <button className={mode === "databricks" ? "mode-active" : ""} onClick={() => setMode("databricks")}>Databricks AI</button>
            </div>
            <span className={`mode-label ${mode === "databricks" ? "mode-label-live" : ""}`}>
              <i /> {mode === "simulation" ? "SCRIPTED · NO MODEL CALL" : "UNITY GATEWAY · SERVER-SIDE"}
            </span>
          </div>

          <div className="playground-messages" aria-live="polite">
            {messages.length === 0 && <div className="playground-empty">
              <span className="copilot-orb">✳</span>
              <h2>Try a sample agent task</h2>
              <p>Ask about the synthetic payment data. Tool calls and their results appear below each response.</p>
              <div className="prompt-suggestions">
                {suggestions.map((suggestion) => (
                  <button key={suggestion} onClick={() => setMessage(suggestion)}>{suggestion}<span>↗</span></button>
                ))}
              </div>
            </div>}

            {messages.map((item, index) => (
              <article className={`chat-message message-${item.role}`} key={`${item.role}-${index}`}>
                <span className="message-avatar">{item.role === "user" ? "You" : "AI"}</span>
                <div className="message-body">
                  <div className="message-meta">
                    <strong>{item.role === "user" ? "You" : "PayNexus agent"}</strong>
                    {item.mode === "simulation" && <span>SIMULATED</span>}
                    {item.mode === "databricks" && <span>{item.model ?? "DATABRICKS"}</span>}
                  </div>
                  <p>{item.content}</p>
                  {item.tools?.map((call, toolIndex) => (
                    <details className="tool-call" key={`${call.tool}-${toolIndex}`} open>
                      <summary><span>↳</span> Tool: <strong>{call.tool}</strong><span className="tool-readonly">READ-ONLY SAMPLE</span></summary>
                      <pre>{JSON.stringify(call.result, null, 2)}</pre>
                    </details>
                  ))}
                </div>
              </article>
            ))}

            {busy && <div className="agent-thinking" role="status"><span className="thinking-dots"><i /><i /><i /></span>{mode === "databricks" ? "Calling Databricks and sample tools…" : "Running simulated tools…"}</div>}
          </div>

          <form className="playground-input" onSubmit={sendMessage}>
            <input
              maxLength={500}
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              placeholder="Ask about a payment, duplicates, or today's totals…"
              aria-label="Ask the demo agent"
              disabled={busy}
            />
            <button type="submit" disabled={busy || !message.trim()}>{busy ? "Working…" : "Run agent"} <span>↑</span></button>
          </form>
          {error && <p className="playground-error" role="alert">{error}</p>}
          <div className="available-tools">
            <span>AVAILABLE SAMPLE TOOLS</span>
            <code>get_demo_payment_summary</code>
            <code>list_demo_payments</code>
            <code>get_demo_payment</code>
            <code>find_demo_duplicates</code>
          </div>
        </section>

        <p className="playground-footnote">Simulation mode is available on the public demo. Databricks AI mode requires the Python service, a valid Databricks token, and permission to use the configured model.</p>
      </div>
    </main>
  );
}
