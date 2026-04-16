"use client";

import { createContext, useContext, useReducer, useCallback, useEffect, ReactNode } from "react";

// ── Pending voice (optimistic — appears in library immediately on submit) ─────
export interface PendingVoice {
  voice_id: string;
  name: string;
  language: string;
  progress: number;
  message: string;
  stepsDone: Set<string>;
}

// ── Actions ──────────────────────────────────────────────────────────────────
type VoiceAction =
  | { type: "VOICE_TRAINING_STARTED"; voiceId: string }
  | { type: "VOICE_TRAINING_OPTIMISTIC"; voiceId: string; name: string; language: string }
  | { type: "VOICE_TRAINING_PROGRESS"; voiceId: string; progress: number; message: string; stepsDone: Set<string> }
  | { type: "VOICE_TRAINED"; voiceId: string }
  | { type: "VOICE_DELETED"; voiceId: string }
  | { type: "VOICE_LIST_CHANGED" }
  | { type: "TRAINED_IDS_HYDRATED"; voiceIds: string[] };

// ── State ────────────────────────────────────────────────────────────────────
interface VoiceState {
  refreshSeq: number;
  trainedVoiceIds: Set<string>;
  /** Voices being trained this session — appear in library immediately. */
  pendingVoices: Map<string, PendingVoice>;
}

function voiceReducer(state: VoiceState, action: VoiceAction): VoiceState {
  switch (action.type) {
    case "VOICE_TRAINING_OPTIMISTIC": {
      const updated = new Map(state.pendingVoices);
      updated.set(action.voiceId, {
        voice_id: action.voiceId,
        name: action.name,
        language: action.language,
        progress: 0,
        message: "Uploading audio clips…",
        stepsDone: new Set(),
      });
      return { ...state, pendingVoices: updated };
    }
    case "VOICE_TRAINING_PROGRESS": {
      const existing = state.pendingVoices.get(action.voiceId);
      if (!existing) return state;
      const updated = new Map(state.pendingVoices);
      updated.set(action.voiceId, {
        ...existing,
        progress: action.progress,
        message: action.message,
        stepsDone: action.stepsDone,
      });
      return { ...state, pendingVoices: updated };
    }
    case "VOICE_TRAINED": {
      const trainedIds = new Set(state.trainedVoiceIds);
      trainedIds.add(action.voiceId);
      // Keep pending voice in map — useVoices deduplicates once server data returns.
      // Removing it here causes a timing gap where the voice briefly disappears.
      return { ...state, refreshSeq: state.refreshSeq + 1, trainedVoiceIds: trainedIds };
    }
    case "VOICE_DELETED": {
      const trainedIds = new Set(state.trainedVoiceIds);
      trainedIds.delete(action.voiceId);
      const pending = new Map(state.pendingVoices);
      pending.delete(action.voiceId);
      return { ...state, refreshSeq: state.refreshSeq + 1, trainedVoiceIds: trainedIds, pendingVoices: pending };
    }
    case "TRAINED_IDS_HYDRATED": {
      const updated = new Set(state.trainedVoiceIds);
      action.voiceIds.forEach((id) => updated.add(id));
      return { ...state, trainedVoiceIds: updated };
    }
    case "VOICE_TRAINING_STARTED":
    case "VOICE_LIST_CHANGED":
      return { ...state, refreshSeq: state.refreshSeq + 1 };
    default:
      return state;
  }
}

// ── Context ──────────────────────────────────────────────────────────────────
interface VoiceContextValue {
  state: VoiceState;
  dispatch: (action: VoiceAction) => void;
}

const VoiceContext = createContext<VoiceContextValue>({
  state: { refreshSeq: 0, trainedVoiceIds: new Set(), pendingVoices: new Map() },
  dispatch: () => {},
});

export function VoiceProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(voiceReducer, {
    refreshSeq: 0,
    trainedVoiceIds: new Set<string>(),
    pendingVoices: new Map<string, PendingVoice>(),
  });

  // Hydrate trainedVoiceIds from API on mount
  useEffect(() => {
    let cancelled = false;
    import("../lib/amt-api").then(({ listVoices, getVoiceTrainingStatus }) => {
      listVoices()
        .then(async (res) => {
          const voices = res.voices || [];
          if (!voices.length || cancelled) return;
          const results = await Promise.allSettled(
            voices.map((v) =>
              getVoiceTrainingStatus(v.voice_id).then((s) => ({
                voiceId: v.voice_id,
                trained: s.status === "complete" || v.training_status === "trained",
              }))
            )
          );
          if (cancelled) return;
          const trainedIds = results
            .filter((r): r is PromiseFulfilledResult<{ voiceId: string; trained: boolean }> =>
              r.status === "fulfilled" && r.value.trained
            )
            .map((r) => r.value.voiceId);
          if (trainedIds.length > 0) dispatch({ type: "TRAINED_IDS_HYDRATED", voiceIds: trainedIds });
        })
        .catch(() => {});
    });
    return () => { cancelled = true; };
  }, []);

  return (
    <VoiceContext.Provider value={{ state, dispatch }}>
      {children}
    </VoiceContext.Provider>
  );
}

export function useVoice() {
  return useContext(VoiceContext);
}

export function useVoiceDispatch() {
  const { dispatch } = useVoice();
  return {
    trainingStarted: useCallback(
      (voiceId: string) => dispatch({ type: "VOICE_TRAINING_STARTED", voiceId }),
      [dispatch],
    ),
    trainingOptimistic: useCallback(
      (voiceId: string, name: string, language: string) =>
        dispatch({ type: "VOICE_TRAINING_OPTIMISTIC", voiceId, name, language }),
      [dispatch],
    ),
    updateTrainingProgress: useCallback(
      (voiceId: string, progress: number, message: string, stepsDone: Set<string>) =>
        dispatch({ type: "VOICE_TRAINING_PROGRESS", voiceId, progress, message, stepsDone }),
      [dispatch],
    ),
    voiceTrained: useCallback(
      (voiceId: string) => dispatch({ type: "VOICE_TRAINED", voiceId }),
      [dispatch],
    ),
    voiceDeleted: useCallback(
      (voiceId: string) => dispatch({ type: "VOICE_DELETED", voiceId }),
      [dispatch],
    ),
    voiceListChanged: useCallback(
      () => dispatch({ type: "VOICE_LIST_CHANGED" }),
      [dispatch],
    ),
  };
}
