"use client";

import { Lock, LogIn } from "lucide-react";
import { useAuth } from "../context/AuthContext";

/**
 * Anonymous-user stand-in for the Voice Library + Clone-a-voice cards.
 * A cloned voice is tied to an account, so enrollment and the library are
 * hidden until the user signs in. The default IndicF5 voice still works
 * pre-login via the Text to Speech card.
 */
export default function VoiceCloneLockedCard() {
  const { login } = useAuth();

  return (
    <div className="vm-card vcl-card">
      <div className="vcl-icon">
        <Lock size={22} strokeWidth={1.75} />
      </div>
      <div className="vcl-title">Sign in to clone your voice</div>
      <p className="vcl-sub">
        Clone your voice from a ~10-second sample and reuse it across Text to Speech and
        live translation. Cloned voices are saved to your account.
      </p>
      <button type="button" className="vcl-btn" onClick={login}>
        <LogIn size={14} strokeWidth={2} />
        Sign in
      </button>

      <style>{`
        .vcl-card {
          display: flex; flex-direction: column; align-items: center; text-align: center;
          justify-content: center; gap: 10px; padding: 32px 24px;
        }
        .vcl-icon {
          width: 52px; height: 52px; border-radius: 14px; display: flex; align-items: center; justify-content: center;
          background: rgba(109,159,55,0.1); border: 1px solid rgba(109,159,55,0.2); color: var(--bamboo-400); margin-bottom: 4px;
        }
        .vcl-title { font-size: 15px; font-weight: 600; color: var(--text-primary); }
        .vcl-sub { font-size: 12px; color: var(--text-muted); line-height: 1.55; margin: 0; max-width: 320px; }
        .vcl-btn {
          display: inline-flex; align-items: center; gap: 7px; margin-top: 6px;
          padding: 9px 18px; border-radius: 9px; border: none;
          background: linear-gradient(135deg, #4a7a28 0%, #6db94a 60%, #a3c96e 100%);
          color: var(--text-primary); font-size: 13px; font-weight: 600; cursor: pointer;
          box-shadow: 0 2px 16px rgba(109,159,55,0.25); transition: opacity 0.15s, transform 0.12s, box-shadow 0.2s;
        }
        .vcl-btn:hover { opacity: 0.92; transform: translateY(-1px); box-shadow: 0 4px 22px rgba(109,159,55,0.38); }
        .vcl-btn:active { transform: translateY(0); }
      `}</style>
    </div>
  );
}
