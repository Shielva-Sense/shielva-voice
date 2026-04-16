/**
 * Login Session Redirect — creates a login session via shielva-identity
 * and redirects to shielva-login with session credentials.
 */

const IDENTITY_URL = process.env.NEXT_PUBLIC_IDENTITY_URL || 'https://localhost:8009';
const LOGIN_URL = process.env.NEXT_PUBLIC_AUTH_URL || 'https://localhost:3000';
const APP_ID = 'VOICE_MANAGER';

async function createBrowserFingerprint(): Promise<string> {
    const raw = `${navigator.userAgent}|${navigator.language}|${navigator.platform}`;
    const encoder = new TextEncoder();
    const data = encoder.encode(raw);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Request a login session from shielva-identity and redirect to shielva-login.
 * Falls back to redirect_uri param if session creation fails.
 */
export async function redirectToLogin(reason?: string): Promise<void> {
    const callbackUrl = typeof window !== 'undefined'
        ? `${window.location.origin}/auth/callback`
        : '';

    // Clear public session ID so authenticated tenant takes over after login
    if (typeof window !== 'undefined') {
        localStorage.removeItem('amt_public_session_id');
    }

    try {
        const fingerprint = await createBrowserFingerprint();
        const res = await fetch(`${IDENTITY_URL}/api/v1/auth/login-session`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                app_id: APP_ID,
                redirect_uri: callbackUrl,
                browser_fingerprint: fingerprint,
            }),
        });

        if (res.ok) {
            const { session_id, user_hash } = await res.json();
            const reasonParam = reason ? `&reason=${reason}` : '';
            window.location.href = `${LOGIN_URL}/login?sid=${session_id}&hash=${user_hash}${reasonParam}`;
            return;
        }

        console.error('[Voice Manager Login Redirect] Session creation rejected:', res.status);
    } catch (err) {
        console.error('[Voice Manager Login Redirect] Failed to connect to identity service:', err);
    }

    // Fallback: identity unavailable — redirect with redirect_uri so login page can still work.
    if (typeof window !== 'undefined') {
        const params = new URLSearchParams();
        params.set('redirect_uri', callbackUrl);
        if (reason) params.set('reason', reason);
        window.location.href = `${LOGIN_URL}/login?${params.toString()}`;
    }
}
