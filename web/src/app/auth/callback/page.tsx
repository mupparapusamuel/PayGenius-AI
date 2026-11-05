"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "../AuthProvider";

export default function AuthCallback() {
  const router = useRouter();
  const { completeSignIn, configured, loading } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const callbackStarted = useRef(false);

  useEffect(() => {
    if (loading || !configured || callbackStarted.current) return;
    callbackStarted.current = true;

    void completeSignIn()
      .then((path) => router.replace(path))
      .catch(() => setError("Sign-in could not be completed. Please return and try again."));
  }, [completeSignIn, configured, loading, router]);

  const visibleError = error ?? (!loading && !configured
    ? "Sign-in is not configured for this application."
    : null);

  return (
    <main className="auth-page">
      <section className="auth-card">
        <span className="brand-mark"><span /></span>
        <h1>Signing you in</h1>
        {visibleError ? <p role="alert">{visibleError}</p> : <p>Completing secure sign-in…</p>}
        {visibleError && <Link className="primary-button" href="/">Return to PayNexus</Link>}
      </section>
    </main>
  );
}
