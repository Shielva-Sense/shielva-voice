"use client";

import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { AudioWaveform } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

export default function LoginPage() {
    const { login } = useAuth();
    const searchParams = useSearchParams();
    const [isRedirecting, setIsRedirecting] = useState(false);

    const error = searchParams.get('error');
    const reason = searchParams.get('reason');

    const handleLogin = () => {
        setIsRedirecting(true);
        login();
    };

    return (
        <div className="vm-login-root">
            <div className="vm-login-card">
                {/* Logo */}
                <div className="vm-login-logo">
                    <div className="vm-logo-icon">
                        <AudioWaveform size={24} color="#fff" strokeWidth={2.5} />
                    </div>
                    <div className="vm-logo-text">
                        Shielva <span>Voice</span>
                    </div>
                </div>

                <h1 className="vm-login-title">Voice Intelligence Platform</h1>
                <p className="vm-login-sub">
                    Real-time speech recognition, voice synthesis, translation, and intent detection.
                </p>

                {/* Status messages */}
                {reason === 'logout' && (
                    <div className="vm-login-notice">You have been signed out.</div>
                )}
                {error === 'auth_failed' && (
                    <div className="vm-login-error">Authentication failed. Please try again.</div>
                )}
                {error === 'auth_service_unavailable' && (
                    <div className="vm-login-error">Auth service is unavailable. Try again shortly.</div>
                )}

                <button
                    className="vm-btn vm-btn-primary vm-login-btn"
                    onClick={handleLogin}
                    disabled={isRedirecting}
                >
                    {isRedirecting ? (
                        <>
                            <span className="vm-login-spinner" />
                            Redirecting...
                        </>
                    ) : (
                        <>
                            Continue with Shielva Auth
                            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style={{ marginLeft: 8 }}>
                                <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                        </>
                    )}
                </button>

                <p className="vm-login-footer-text">
                    Secured by Shielva Identity &middot; Enterprise SSO
                </p>
            </div>

            <style>{`
                .vm-login-root {
                    min-height: 100vh;
                    background: var(--black);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    padding: 24px;
                }
                .vm-login-card {
                    background: var(--surface-card);
                    border: 1px solid var(--border);
                    border-radius: 16px;
                    padding: 48px 40px;
                    width: 100%;
                    max-width: 420px;
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    gap: 16px;
                    text-align: center;
                }
                .vm-login-logo {
                    display: flex;
                    align-items: center;
                    gap: 10px;
                    margin-bottom: 8px;
                }
                .vm-login-title {
                    font-size: 22px;
                    font-weight: 700;
                    color: var(--white);
                    margin: 0;
                    line-height: 1.3;
                }
                .vm-login-sub {
                    font-size: 14px;
                    color: var(--text-muted);
                    margin: 0;
                    line-height: 1.6;
                    max-width: 320px;
                }
                .vm-login-btn {
                    width: 100%;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    gap: 4px;
                    padding: 13px 24px;
                    font-size: 15px;
                    margin-top: 8px;
                    border-radius: 10px;
                }
                .vm-login-spinner {
                    display: inline-block;
                    width: 16px;
                    height: 16px;
                    border: 2px solid rgba(255,255,255,0.3);
                    border-top-color: #fff;
                    border-radius: 50%;
                    animation: spin 0.7s linear infinite;
                    margin-right: 8px;
                }
                @keyframes spin { to { transform: rotate(360deg); } }
                .vm-login-notice {
                    background: rgba(109, 159, 55, 0.1);
                    border: 1px solid rgba(109, 159, 55, 0.3);
                    color: var(--bamboo-400, #a3c96e);
                    border-radius: 8px;
                    padding: 10px 16px;
                    font-size: 13px;
                    width: 100%;
                }
                .vm-login-error {
                    background: rgba(239, 68, 68, 0.08);
                    border: 1px solid rgba(239, 68, 68, 0.25);
                    color: #f87171;
                    border-radius: 8px;
                    padding: 10px 16px;
                    font-size: 13px;
                    width: 100%;
                }
                .vm-login-footer-text {
                    font-size: 12px;
                    color: var(--text-muted);
                    margin: 4px 0 0;
                    opacity: 0.6;
                }
            `}</style>
        </div>
    );
}
