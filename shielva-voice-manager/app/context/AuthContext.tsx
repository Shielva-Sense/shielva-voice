"use client";

import { createContext, useContext, useEffect, useState, useCallback, useRef, ReactNode } from 'react';
import { setAmtAuthState } from '../lib/amt-api';
import { redirectToLogin } from '../lib/login-redirect';

const IDENTITY_URL = process.env.NEXT_PUBLIC_IDENTITY_URL || 'https://localhost:8009';
const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'https://localhost:8000';

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
            const res = await fetch(`${API_BASE}/amt/v1/metering/usage`, { credentials: 'include' });
            if (res.ok) {
                setUsageInfo(await res.json());
            }
        } catch {}
    }, []);

    useEffect(() => {
        const validateSession = async () => {
            try {
                const res = await fetch(`${IDENTITY_URL}/api/v1/unified/me`, {
                    credentials: 'include',
                });

                if (res.ok) {
                    const data = await res.json();
                    const u: User = {
                        id: data.id || data.sub || '',
                        name: data.name || data.full_name || '',
                        email: data.email || '',
                        tenants: data.tenants || [],
                        role: data.role,
                        globalPersona: data.globalPersona,
                    };
                    userRef.current = u;
                    setUser(u);
                    setAmtAuthState(true, data.tenants?.[0], data.tenant_name || '');
                    // Purge stale R2 temp cache on login (best-effort, non-blocking)
                    fetch(`${API_BASE}/amt/v1/session/logout`, {
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
        const loginRoot = (process.env.NEXT_PUBLIC_AUTH_URL || 'https://localhost:3000').replace(/\/$/, '');
        const handleVisibility = async () => {
            if (document.visibilityState !== 'visible') return;
            if (isLoadingRef.current) return;
            try {
                const res = await fetch(`${API_BASE}/identity/api/v1/unified/me`, { credentials: 'include' });
                if (res.ok) {
                    const data = await res.json() as Record<string, unknown>;
                    const u: User = {
                        id: (data.id || data.sub || '') as string,
                        name: (data.name as string) || '',
                        email: (data.email as string) || '',
                        tenants: (data.tenants as string[]) || [],
                        role: data.role as string | undefined,
                        globalPersona: data.globalPersona as string | undefined,
                    };
                    userRef.current = u;
                    setUser(u);
                    setSessionRejected(false);
                } else if (res.status === 401 || res.status === 403) {
                    if (!userRef.current) return;
                    userRef.current = null;
                    setAmtAuthState(false);
                    setUser(null);
                    setSessionRejected(true);
                    const returnTo = encodeURIComponent(window.location.origin);
                    window.location.href = `${loginRoot}?return_to=${returnTo}`;
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
                await fetch(`${IDENTITY_URL}/api/v1/unified/me`, { credentials: 'include' });
            } catch {
                // Non-fatal — if it fails, the full validateSession on next page load handles it
            }
        };
        const interval = setInterval(keepAlive, 30 * 60 * 1000); // every 30 minutes
        return () => clearInterval(interval);
    }, []);

    const login = () => redirectToLogin();

    const logout = async () => {
        // 1. Fire R2 cache purge for this tenant (best-effort, non-blocking)
        //    Removes synthesis cache + public session voice uploads from R2.
        fetch(`${API_BASE}/amt/v1/session/logout`, {
            method: 'POST',
            credentials: 'include',
        }).catch(() => { /* non-fatal */ });

        // 2. Identity service logout
        try {
            const csrfToken = typeof document !== 'undefined'
                ? (document.cookie.match(/shielva_csrf=([^;]+)/)?.[1] ?? null)
                : null;
            await fetch(`${IDENTITY_URL}/api/v1/unified/logout`, {
                method: 'POST',
                credentials: 'include',
                headers: {
                    'Content-Type': 'application/json',
                    ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}),
                },
            });
        } catch {
            // Proceed with client-side cleanup regardless
        }
        userRef.current = null;
        setAmtAuthState(false);
        setUser(null);
        setUsageInfo(null);
        setSessionRejected(false);
        await redirectToLogin('logout');
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
