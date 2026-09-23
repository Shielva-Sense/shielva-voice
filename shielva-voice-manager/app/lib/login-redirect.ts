/**
 * Login Session Redirect — creates a login session via shielva-identity
 * and redirects to shielva-login with session credentials.
 */

const IDENTITY_URL = process.env.NEXT_PUBLIC_IDENTITY_URL || 'https://localhost:8009';
const LOGIN_URL = process.env.NEXT_PUBLIC_AUTH_URL || 'https://localhost:3000';
const APP_ID = 'VOICE_MANAGER';
const APP_SLUG = 'voice';

/**
 * The browser this grant was minted for, as the sign-in app will recompute it.
 *
 * 🚨 THE TWO SIDES MUST HASH THE SAME STRING, AND FOR MONTHS THEY DID NOT.
 * Identity stores this at `POST /auth/login-session` and compares it at
 * `/login-session/validate`; a mismatch is read as session fixation, the grant
 * is INVALIDATED, and validate answers `{valid: false}` — inside an HTTP 200,
 * which is why nothing anywhere reported an error.
 *
 * This app hashed `userAgent|language|platform`. The sign-in app hashes those
 * three PLUS `screen.width|screen.height|timeZone`. So every grant from here
 * failed, every time, and the sign-in app fell back to `return_to` instead of
 * the grant's redirect_uri — delivering the token to whatever page the visitor
 * came from rather than to the callback that reads one.
 *
 * ARC hit exactly this on 2026-09-23: sign in, land back on a page that does
 * not read a token, sign in again, about a cycle a second with credentials
 * asked once. Fixed there in shielva-arc#114; this is the same break, found by
 * grep before anybody met it here.
 *
 * Six fields, in this order, joined by `|`. Do not "simplify" it. If the
 * sign-in app's recipe ever changes, this changes in the same commit.
 */
async function createBrowserFingerprint(): Promise<string> {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const raw = [
        navigator.userAgent,
        navigator.language,
        navigator.platform,
        screen.width,
        screen.height,
        tz,
    ].join('|');
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
            const params = new URLSearchParams({ sid: session_id, hash: user_hash, app: APP_SLUG });
            if (reason) params.set('reason', reason);
            params.set('return_to', window.location.origin);
            window.location.href = `${LOGIN_URL}/login?${params.toString()}`;
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
        params.set('app', APP_SLUG);
        if (reason) params.set('reason', reason);
        params.set('return_to', window.location.origin);
        window.location.href = `${LOGIN_URL}/login?${params.toString()}`;
    }
}

/**
 * Send a user who has no organisation to the sign-in app's org-setup step.
 *
 * A voice signup deliberately gets NO tenant from identity
 * (`requires_own_organisation`), precisely so the user names their own
 * organisation here. Without this the user would land in voice tenant-less and
 * never be asked — which is the state ARC was in before it grew the same guard.
 */
export async function redirectToOrgSetup(): Promise<void> {
    if (typeof window === 'undefined') return;

    // redirect_uri points at voice's own callback so the token flow completes on return.
    const callbackUrl = `${window.location.origin}/auth/callback`;

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
            window.location.href = `${LOGIN_URL}/login?sid=${session_id}&hash=${user_hash}&app=${APP_SLUG}&setup_org=true`;
            return;
        }
        console.error('[Voice Org Setup Redirect] Session creation rejected:', res.status);
    } catch (err) {
        console.error('[Voice Org Setup Redirect] Failed to connect to identity service:', err);
    }

    // Identity unavailable — still send them to the org step; the sign-in app
    // will re-authenticate if the grant is missing.
    window.location.href = `${LOGIN_URL}/login?app=${APP_SLUG}&setup_org=true&redirect_uri=${encodeURIComponent(callbackUrl)}`;
}
