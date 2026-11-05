"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { UserManager, WebStorageStateStore, type User } from "oidc-client-ts";

type AuthContextValue = {
  configured: boolean;
  loading: boolean;
  user: User | null;
  error: string | null;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
  completeSignIn: () => Promise<string>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

function isOidcConfigured() {
  return Boolean(
    process.env.NEXT_PUBLIC_OIDC_AUTHORITY &&
    process.env.NEXT_PUBLIC_OIDC_CLIENT_ID,
  );
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const manager = useRef<UserManager | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(() => isOidcConfigured());
  const [error, setError] = useState<string | null>(null);
  const configured = isOidcConfigured();

  useEffect(() => {
    if (!configured) return;

    const apiScope = process.env.NEXT_PUBLIC_OIDC_API_SCOPE?.trim();
    const oidcManager = new UserManager({
      authority: process.env.NEXT_PUBLIC_OIDC_AUTHORITY!,
      client_id: process.env.NEXT_PUBLIC_OIDC_CLIENT_ID!,
      redirect_uri: `${window.location.origin}/auth/callback`,
      post_logout_redirect_uri: window.location.origin,
      response_type: "code",
      scope: ["openid", "profile", "email", apiScope].filter(Boolean).join(" "),
      userStore: new WebStorageStateStore({ store: window.sessionStorage }),
      stateStore: new WebStorageStateStore({ store: window.sessionStorage }),
      automaticSilentRenew: false,
      monitorSession: false,
    });

    const onUserLoaded = (loadedUser: User) => setUser(loadedUser);
    const onUserUnloaded = () => setUser(null);
    oidcManager.events.addUserLoaded(onUserLoaded);
    oidcManager.events.addUserUnloaded(onUserUnloaded);
    manager.current = oidcManager;

    void oidcManager.getUser()
      .then(setUser)
      .catch(() => setError("Could not load the sign-in session. Please sign in again."))
      .finally(() => setLoading(false));

    return () => {
      oidcManager.events.removeUserLoaded(onUserLoaded);
      oidcManager.events.removeUserUnloaded(onUserUnloaded);
    };
  }, [configured]);

  const signIn = useCallback(async () => {
    if (!manager.current) throw new Error("Sign-in is not configured.");
    setError(null);
    await manager.current.signinRedirect({ state: { returnTo: "/workspace" } });
  }, []);

  const signOut = useCallback(async () => {
    if (!manager.current) throw new Error("Sign-in is not configured.");
    await manager.current.signoutRedirect();
  }, []);

  const completeSignIn = useCallback(async () => {
    if (!manager.current) throw new Error("Sign-in is not configured.");
    const signedInUser = await manager.current.signinRedirectCallback();
    setUser(signedInUser);
    const state: unknown = signedInUser.state;
    const returnTo = typeof state === "object" && state !== null && "returnTo" in state
      ? Reflect.get(state, "returnTo")
      : null;
    return returnTo === "/workspace" ? returnTo : "/workspace";
  }, []);

  const value: AuthContextValue = {
    configured,
    loading,
    user,
    error,
    signIn,
    signOut,
    completeSignIn,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside AuthProvider.");
  return context;
}
