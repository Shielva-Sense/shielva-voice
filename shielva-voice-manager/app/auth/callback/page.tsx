"use client";

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';

const IDENTITY_URL = process.env.NEXT_PUBLIC_IDENTITY_URL || 'https://localhost:8009';

function CallbackContent() {
    const processingRef = useRef(false);
    const router = useRouter();

    useEffect(() => {
        // Prevent double processing in React Strict Mode
        if (processingRef.current) return;
        processingRef.current = true;

        const validateAndRedirect = async () => {
            try {
                // Primary: cookie-based auth (HttpOnly cookie set by identity service on login)
                const res = await fetch(
                    `${IDENTITY_URL}/identity/api/v1/unified/me`,
                    { credentials: 'include' }
                );
                if (res.ok) {
                    router.replace('/');
                    return;
                }

                // Fallback: shielva-login passes ?token=TOKEN in the redirect URL.
                const params = new URLSearchParams(window.location.search);
                const token = params.get('token');
                if (token) {
                    const tokenRes = await fetch(
                        `${IDENTITY_URL}/identity/api/v1/unified/me`,
                        {
                            credentials: 'include',
                            headers: { 'Authorization': `Bearer ${token}` },
                        }
                    );
                    if (tokenRes.ok) {
                        router.replace('/');
                        return;
                    }
                }

                router.replace('/login?error=auth_failed');
            } catch {
                router.replace('/login?error=auth_failed');
            }
        };

        validateAndRedirect();
    }, [router]);

    return (
        <div style={{
            position: 'fixed', inset: 0, background: '#000',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 9999,
        }}>
            <div style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center',
                gap: '20px', textAlign: 'center',
            }}>
                <div style={{
                    width: '56px', height: '56px',
                    border: '3px solid rgba(109, 159, 55, 0.15)',
                    borderTopColor: '#6d9f37',
                    borderRadius: '50%',
                    animation: 'spin 0.8s linear infinite',
                }} />
                <div>
                    <h2 style={{ fontSize: '20px', fontWeight: 700, color: '#fff', margin: '0 0 6px' }}>Almost there</h2>
                    <p style={{ fontSize: '14px', color: '#888', margin: 0 }}>Signing you in...</p>
                </div>
            </div>
            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
    );
}

export default function AuthCallback() {
    return <CallbackContent />;
}
