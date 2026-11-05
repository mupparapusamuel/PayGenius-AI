"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useAuth } from "../auth/AuthProvider";

type Investigation = {
  id: string;
  transactionReference: string;
  customerMessage: string;
  status: string;
  createdAt: string;
};

type Analysis = {
  likelyCause: string;
  explanation: string;
  recommendedNextStep: string;
  confidence: number;
  needsHumanReview: boolean;
  evidenceIds: string[];
};

type ProviderEvidence = {
  id: string;
  status: string;
  intent: string | null;
  createdAt: string | null;
};

const apiUrl = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "");

async function apiRequest<T>(path: string, accessToken: string, init?: RequestInit): Promise<T> {
  if (!apiUrl) throw new Error("NEXT_PUBLIC_API_URL is not configured.");
  const response = await fetch(`${apiUrl}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });
  if (!response.ok) {
    const problem = await response.json().catch(() => null) as { detail?: string } | null;
    throw new Error(problem?.detail ?? `Request failed (${response.status}).`);
  }
  return response.json() as Promise<T>;
}

export default function Workspace() {
  const { configured, loading, user, error: authError, signIn, signOut } = useAuth();
  const [investigations, setInvestigations] = useState<Investigation[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [providerEvidence, setProviderEvidence] = useState<ProviderEvidence | null>(null);
  const [transactionReference, setTransactionReference] = useState("");
  const [customerMessage, setCustomerMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const accessToken = user?.access_token;

  const loadInvestigations = useCallback(async () => {
    if (!accessToken) return;
    const items = await apiRequest<Investigation[]>("/api/investigations", accessToken);
    setInvestigations(items);
  }, [accessToken]);

  useEffect(() => {
    if (!accessToken) return;
    let active = true;
    void apiRequest<Investigation[]>("/api/investigations", accessToken)
      .then((items) => {
        if (active) setInvestigations(items);
      })
      .catch((loadError: unknown) => {
        if (active) setError(loadError instanceof Error ? loadError.message : "Could not load investigations.");
      });
    return () => { active = false; };
  }, [accessToken]);

  async function submitInvestigation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!accessToken) return;

    setBusy(true);
    setError(null);
    setNotice(null);
    setAnalysis(null);
    setProviderEvidence(null);
    let created: Investigation;
    try {
      created = await apiRequest<Investigation>("/api/investigations", accessToken, {
        method: "POST",
        body: JSON.stringify({ transactionReference, customerMessage }),
      });
      setSelectedId(created.id);
      setInvestigations((current) => [created, ...current.filter((item) => item.id !== created.id)]);
      setNotice("Investigation created. Checking the PayPal sandbox order and verified evidence…");
      const result = await apiRequest<{ status: string; analysis: Analysis; providerEvidence: ProviderEvidence }>(
        `/api/investigations/${created.id}/analyze`,
        accessToken,
        { method: "POST" },
      );
      setAnalysis(result.analysis);
      setProviderEvidence(result.providerEvidence);
      setNotice(`Read-only analysis complete. Case status: ${result.status.replaceAll("_", " ")}.`);
      await loadInvestigations();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Investigation request failed.");
      try {
        await loadInvestigations();
      } catch {
        setError((current) => `${current} The case list could not be refreshed.`);
      }
    } finally {
      setBusy(false);
    }
  }

  async function selectInvestigation(item: Investigation) {
    setSelectedId(item.id);
    setAnalysis(null);
    setProviderEvidence(null);
    setError(null);
    if (!accessToken) return;
    try {
      const detail = await apiRequest<{
        analysis?: Analysis | null;
        providerEvidence?: ProviderEvidence | null;
      }>(
        `/api/investigations/${item.id}`,
        accessToken,
      );
      setAnalysis(detail.analysis ?? null);
      setProviderEvidence(detail.providerEvidence ?? null);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not load investigation.");
    }
  }

  return (
    <main className="workspace-page">
      <header className="workspace-header">
        <Link className="brand" href="/">
          <span className="brand-mark"><span /></span>
          <span>paynexus<span className="brand-ai">.ai</span></span>
        </Link>
        <div className="workspace-header-actions">
          <span className="environment-pill"><span /> Sandbox · read-only</span>
          {user && <button className="secondary-button" onClick={() => void signOut().catch(() => setError("Sign-out could not be completed."))}>Sign out</button>}
        </div>
      </header>

      <div className="workspace-content">
        <div className="workspace-title">
          <p className="eyebrow">MERCHANT OPERATIONS</p>
          <h1>Payment investigations</h1>
          <p>Investigate PayPal sandbox orders using read-only provider data and evidence-grounded AI.</p>
        </div>

        {!configured && <div className="workspace-alert" role="alert">
          Sign-in is not configured. Set the OIDC authority and public client ID in the web environment.
        </div>}
        {configured && loading && <p className="workspace-muted">Checking your sign-in session…</p>}
        {configured && !loading && !user && <section className="workspace-card sign-in-card">
          <h2>Sign in to your merchant workspace</h2>
          <p>Your identity provider must issue an API access token with a trusted <code>tenant_id</code> claim.</p>
          <button className="primary-button" onClick={() => void signIn().catch((signInError: unknown) => setError(signInError instanceof Error ? signInError.message : "Sign-in could not be started."))}>Continue with secure sign-in <span>→</span></button>
          {authError && <p className="workspace-error" role="alert">{authError}</p>}
          {error && <p className="workspace-error" role="alert">{error}</p>}
        </section>}

        {user && <div className="workspace-layout">
          <section className="workspace-card investigation-form-card">
            <div className="workspace-card-heading">
              <div><h2>Start an investigation</h2><p>Only PayPal order references; no card details.</p></div>
              <span className="read-only-badge">READ-ONLY</span>
            </div>
            <form className="investigation-form" onSubmit={submitInvestigation}>
              <label>
                PayPal order reference
                <input
                  required
                  maxLength={128}
                  pattern="[A-Za-z0-9._-]+"
                  value={transactionReference}
                  onChange={(event) => setTransactionReference(event.target.value)}
                  placeholder="e.g. 5O190127TN364715T"
                />
              </label>
              <label>
                Customer’s issue
                <textarea
                  required
                  maxLength={2000}
                  value={customerMessage}
                  onChange={(event) => setCustomerMessage(event.target.value)}
                  placeholder="Describe the payment issue. Never include card numbers or security codes."
                  rows={4}
                />
              </label>
              <button className="primary-button" disabled={busy}>
                {busy ? "Investigating…" : "Create & investigate"} <span>→</span>
              </button>
            </form>
            <p className="safety-note">The system only reads a PayPal sandbox order. It cannot issue refunds, retry payments, or change orders.</p>
            {notice && <p className="workspace-notice" role="status">{notice}</p>}
            {error && <p className="workspace-error" role="alert">{error}</p>}
          </section>

          <section className="workspace-card">
            <div className="workspace-card-heading">
              <div><h2>Your investigations</h2><p>Tenant-scoped records from the control plane.</p></div>
              <button className="secondary-button" onClick={() => void loadInvestigations().catch((refreshError: unknown) => setError(refreshError instanceof Error ? refreshError.message : "Could not refresh investigations."))}>Refresh</button>
            </div>
            {investigations.length === 0
              ? <p className="workspace-muted">No investigations yet.</p>
              : <ul className="investigation-list">
                {investigations.map((item) => (
                  <li key={item.id}>
                    <button className={`investigation-list-item ${selectedId === item.id ? "is-selected" : ""}`} onClick={() => void selectInvestigation(item)}>
                      <span><strong>{item.transactionReference}</strong><small>{item.customerMessage}</small></span>
                      <span className={`case-status status-${item.status}`}>{item.status.replaceAll("_", " ")}</span>
                    </button>
                  </li>
                ))}
              </ul>}
            {analysis && <div className="analysis-result" aria-live="polite">
              <div className="workspace-card-heading"><h3>Evidence-based analysis</h3><span>{Math.round(analysis.confidence * 100)}% confidence</span></div>
              {providerEvidence && <p><strong>PayPal sandbox:</strong> Order {providerEvidence.id} is {providerEvidence.status}. {providerEvidence.intent ? `Intent: ${providerEvidence.intent}.` : ""}</p>}
              <p><strong>Likely cause:</strong> {analysis.likelyCause}</p>
              <p>{analysis.explanation}</p>
              <p><strong>Next step:</strong> {analysis.recommendedNextStep}</p>
              <p className={analysis.needsHumanReview ? "workspace-error" : "workspace-muted"}>
                {analysis.needsHumanReview ? "Human review required" : "Read-only finding"}
              </p>
              <small>Evidence: {analysis.evidenceIds.join(", ") || "none cited"}</small>
            </div>}
          </section>
        </div>}
        <p className="workspace-disclaimer">Demo dashboard sample data is separate from this authenticated merchant workspace.</p>
      </div>
    </main>
  );
}
