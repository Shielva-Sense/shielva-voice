"use client";

import { createContext, useContext, useState, useCallback, useEffect, useMemo, ReactNode } from "react";

// ── Default voice ─────────────────────────────────────────────────────────────
// Chatterbox clones zero-shot from a reference clip, so there is no training state to
// track. The only cross-component voice state we keep is the user's preferred
// "default" cloned voice — persisted locally and used to pre-select the TTS /
// real-time voice pickers.

const DEFAULT_VOICE_LS_KEY = "vm_default_voice_id";

interface VoiceContextValue {
  /** voice_id the user marked as their default, or null for the built-in Chatterbox reference. */
  defaultVoiceId: string | null;
  setDefaultVoice: (voiceId: string | null) => void;
}

const VoiceContext = createContext<VoiceContextValue>({
  defaultVoiceId: null,
  setDefaultVoice: () => {},
});

export function VoiceProvider({ children }: { children: ReactNode }) {
  const [defaultVoiceId, setDefaultVoiceId] = useState<string | null>(null);

  // Hydrate from localStorage after mount (SSR-safe).
  useEffect(() => {
    try {
      setDefaultVoiceId(localStorage.getItem(DEFAULT_VOICE_LS_KEY));
    } catch {
      /* localStorage unavailable — ignore */
    }
  }, []);

  const setDefaultVoice = useCallback((voiceId: string | null) => {
    setDefaultVoiceId(voiceId);
    try {
      if (voiceId) localStorage.setItem(DEFAULT_VOICE_LS_KEY, voiceId);
      else localStorage.removeItem(DEFAULT_VOICE_LS_KEY);
    } catch {
      /* localStorage unavailable — ignore */
    }
  }, []);

  const value = useMemo<VoiceContextValue>(
    () => ({ defaultVoiceId, setDefaultVoice }),
    [defaultVoiceId, setDefaultVoice],
  );

  return <VoiceContext.Provider value={value}>{children}</VoiceContext.Provider>;
}

export function useVoice() {
  return useContext(VoiceContext);
}
