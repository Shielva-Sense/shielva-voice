"use client";

import { createContext, useContext, useEffect, useState, useCallback, useRef, ReactNode } from 'react';
import { setAmtAuthState } from '../lib/amt-api';
import { redirectToLogin } from '../lib/login-redirect';

const IDENTITY_URL = process.env.NEXT_PUBLIC_IDENTITY_URL || 'https://localhost:8009';
// Inference routes (pod, no auth) go via the single-origin tunnel.
const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'https://localhost:8000';
// Gateway-auth'd DB routes (metering, session) require the session cookie, which
// is host-scoped to the identity/gateway host — so they must be called there,
// not via API_BASE (voice.shielva.ai), or the cookie is never sent → 401.
const GATEWAY_BASE = process.env.NEXT_PUBLIC_IDENTITY_URL || 'https://api.shielva.ai';

interface User {
    id: string;
    name: string;
    email: string;
    tenants: string[];
    role?: string;
    globalPersona?: string;
}

export interface UsageInfo {
    plan: string;
    quotas: { text_chars: number; voice_minutes: number };
    usage: { text_chars: number; voice_minutes: number };
}

interface AuthContextValue {
    user: User | null;
    isAuthenticated: boolean;
    isSuperAdmin: boolean;
    isLoading: boolean;
    sessionRejected: boolean;
    usageInfo: UsageInfo | null;
    refreshUsage: () => Promise<void>;
    login: () => void;
    logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
    user: null,
    isAuthenticated: false,
    isSuperAdmin: false,
    isLoading: true,
    sessionRejected: false,
    usageInfo: null,
    refreshUsage: async () => {},
    login: () => {},
    logout: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
    const [user, setUser] = useState<User | null>(null);
    const userRef = useRef<User | null>(null);
    const isLoadingRef = useRef(true);
    const [isLoading, setIsLoading] = useState(true);
    const [sessionRejected, setSessionRejected] = useState(false);
    const [usageInfo, setUsageInfo] = useState<UsageInfo | null>(null);

    const refreshUsage = useCallback(async () => {
        try {
            const res = await fetch(`${GATEWAY_BASE}/amt/v1/metering/usage`, { credentials: 'include' });
            if (res.ok) {
                setUsageInfo(await res.json());
            }
        } catch {}
    }, []);

    useEffect(() => {
        const validateSession = async () => {
            try {
                const res = await fetch(`${IDENTITY_URL}/identity/api/v1/unified/me`, {
                    credentials: 'include',
                });

                if (res.ok) {
                    const data = await res.json();
                    const u: User = {
                        id: data.id || data.sub || '',
                        name: data.name || data.full_name || '',
                        email: data.email || '',
                        // /me returns tenant_id (string), not a tenants[] array — normalise so
                        // downstream consumers (and AMT tenant scoping) always have the tenant.
                        tenants: data.tenants || (data.tenant_id ? [data.tenant_id] : []),
                        role: data.role,
                        globalPersona: data.globalPersona,
                    };
                    userRef.current = u;
                    setUser(u);
                    // tenant_id is the canonical field on /me; tenants[0] is a legacy fallback.
                    // Without this, _tenantId stays null and amtHeaders() omits X-Tenant-Name,
                    // so every authenticated AMT call (synthesize/transcribe/enroll) 422s.
                    setAmtAuthState(true, data.tenant_id || data.tenants?.[0], data.tenant_name || '');
                    // Purge stale R2 temp cache on login (best-effort, non-blocking)
                    fetch(`${GATEWAY_BASE}/amt/v1/session/logout`, {
                        method: 'POST',
                        credentials: 'include',
                    }).catch(() => { /* non-fatal */ });
                    // Fetch usage info after successful session validation
                    refreshUsage();
                } else if (res.status === 401 || res.status === 403) {
                    setAmtAuthState(false);
                    setSessionRejected(true);
                }
            } catch {
                // Network error — don't reject session, allow retry
            } finally {
                isLoadingRef.current = false;
                setIsLoading(false);
            }
        };

        validateSession();
    }, [refreshUsage]);

    // Cross-app SSO: re-validate on tab focus.
    useEffect(() => {
        const handleVisibility = async () => {
            if (document.visibilityState !== 'visible') return;
            if (isLoadingRef.current) return;
            try {
                // Must hit IDENTITY_URL (identity/gateway host that owns the session
                // cookie) — API_BASE (voice.shielva.ai) never carries the host-scoped
                // cookie, so /me there 401s → forced logout → login-redirect loop.
                const res = await fetch(`${IDENTITY_URL}/identity/api/v1/unified/me`, { credentials: 'include' });
                if (res.ok) {
                    const data = await res.json() as Record<string, unknown>;
                    const tenantId = (data.tenant_id as string) || (data.tenants as string[])?.[0];
                    const u: User = {
                        id: (data.id || data.sub || '') as string,
                        name: (data.name as string) || '',
                        email: (data.email as string) || '',
                        tenants: (data.tenants as string[]) || (tenantId ? [tenantId] : []),
                        role: data.role as string | undefined,
                        globalPersona: data.globalPersona as string | undefined,
                    };
                    userRef.current = u;
                    setUser(u);
                    setAmtAuthState(true, tenantId, (data.tenant_name as string) || '');
                    setSessionRejected(false);
                } else if (res.status === 401 || res.status === 403) {
                    if (!userRef.current) return;
                    userRef.current = null;
                    setAmtAuthState(false);
                    setUser(null);
                    setSessionRejected(true);
                    // Go through the proper login-session flow (lands on the actual
                    // form), not the login splash page via a manual return_to redirect.
                    redirectToLogin();
                }
            } catch {}
        };
        document.addEventListener('visibilitychange', handleVisibility);
        return () => document.removeEventListener('visibilitychange', handleVisibility);
    }, []);

    // ── Silent session keep-alive — re-hit /me every 30 min to slide the cookie expiry ──
    // This ensures the rolling 30-day session never expires while the tab is open.
    useEffect(() => {
        const keepAlive = async () => {
            try {
                await fetch(`${IDENTITY_URL}/identity/api/v1/unified/me`, { credentials: 'include' });
            } catch {
                // Non-fatal — if it fails, the full validateSession on next page load handles it
            }
        };
        const interval = setInterval(keepAlive, 30 * 60 * 1000); // every 30 minutes
        return () => clearInterval(interval);
    }, []);

    const login = () => redirectToLogin();

    const logout = async () => {
        // Mirrors shielva-arc's performLogout(). The previous version only purged
        // the R2 cache and cleared local React state, then redirected — it NEVER
        // revoked the server session, so the shielva_sso cookie stayed valid and
        // validateSession logged the user straight back in. Real logout = revoke
        // the server session cookie + cross-app sync + expire readable cookies.

        // 1. R2 cache purge for this tenant (voice-manager specific; best-effort).
        fetch(`${GATEWAY_BASE}/amt/v1/session/logout`, {
            method: 'POST',
            credentials: 'include',
        }).catch(() => { /* non-fatal */ });

        // 2. Server-side session revoke — clears the HttpOnly shielva_sso cookie via
        //    Set-Cookie. THIS is what actually ends the session (was missing).
        try {
            const csrf = document.cookie.match(/(?:^|;\s*)csrf_token=([^;]+)/)?.[1];
            const headers: Record<string, string> = { 'Content-Type': 'application/json' };
            if (csrf) headers['X-CSRF-Token'] = decodeURIComponent(csrf);
            // Identity/unified route → IDENTITY_URL (session-cookie host), never API_BASE.
            await fetch(`${IDENTITY_URL}/identity/api/v1/unified/logout`, {
                method: 'POST',
                credentials: 'include',
                headers,
            });
        } catch { /* non-fatal — client-side clear below still runs */ }

        // 3. Cross-app logout sync (fleet-wide), like ARC. Best-effort, non-blocking.
        fetch(`${API_BASE}/bots/trigger-logout`, {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
        }).catch(() => { /* non-blocking */ });

        // 4. Clear local state + force-expire readable SSO/CSRF cookies (belt-and-
        //    suspenders; the HttpOnly cookie is cleared by the server Set-Cookie above,
        //    but on the shared .shielva.ai registrable domain we clear that variant too).
        userRef.current = null;
        setAmtAuthState(false);
        setUser(null);
        setUsageInfo(null);
        setSessionRejected(false);
        if (typeof window !== 'undefined') {
            localStorage.removeItem('amt_public_session_id');
            const expiry = 'expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;';
            const host = window.location.hostname;
            const cookieDomain = host === 'localhost' ? 'localhost' : '.' + host.split('.').slice(-2).join('.');
            document.cookie = `shielva_sso=; ${expiry}`;
            document.cookie = `shielva_sso=; ${expiry} domain=${cookieDomain};`;
            document.cookie = `csrf_token=; ${expiry}`;
            document.cookie = `csrf_token=; ${expiry} domain=${cookieDomain};`;
        }

        // 5. Back to the login gate.
        window.location.replace('/login');
    };

    const isSuperAdmin = !!(user?.role === 'super_admin' || user?.globalPersona === 'SUPERADMIN');

    return (
        <AuthContext.Provider value={{
            user,
            isAuthenticated: !!user,
            isSuperAdmin,
            isLoading,
            sessionRejected,
            usageInfo,
            refreshUsage,
            login,
            logout,
        }}>
            {children}
        </AuthContext.Provider>
    );
}

export function useAuth() {
    return useContext(AuthContext);
}
