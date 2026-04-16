"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { listVoices, getVoiceTrainingStatus, type VoiceInfo } from "../lib/amt-api";
import { useVoice } from "../context/VoiceContext";

export const VOICES_KEY = ["voices"] as const;

async function fetchVoicesWithStatus(): Promise<VoiceInfo[]> {
  const { voices } = await listVoices();
  if (!voices.length) return [];

  const statuses = await Promise.allSettled(
    voices.map((v) => getVoiceTrainingStatus(v.voice_id))
  );

  return voices.map((v, i) => {
    const result = statuses[i];
    if (result.status === "fulfilled") {
      const s = result.value.status;
      if (s === "complete") return { ...v, training_status: "trained" as const };
      if (s === "processing" || s === "pending" || s === "uploading_rvc")
        return { ...v, training_status: "training" as const };
    }
    return v;
  });
}

export function useVoices() {
  const { state: { trainedVoiceIds, pendingVoices } } = useVoice();

  const query = useQuery({
    queryKey: VOICES_KEY,
    queryFn: fetchVoicesWithStatus,
    staleTime: 30_000,
  });

  // Apply trainedVoiceIds override ONLY when server doesn't say "training".
  // If server returns "training" (RVC model still building), respect that status.
  const serverVoices: VoiceInfo[] = (query.data ?? []).map((v) =>
    trainedVoiceIds.has(v.voice_id) && v.training_status !== "training"
      ? { ...v, training_status: "trained" as const }
      : v
  );

  // Inject pending voices that haven't shown up from the server yet.
  // If the voice is already in trainedVoiceIds (VOICE_TRAINED fired), show it as
  // "trained" so the progress bar immediately disappears and the normal card renders.
  const serverIds = new Set(serverVoices.map((v) => v.voice_id));
  const pendingAsVoices: VoiceInfo[] = [];
  pendingVoices.forEach((p) => {
    if (!serverIds.has(p.voice_id)) {
      // Always show as "training" — "trained" is only set by the server once RVC is done.
      pendingAsVoices.push({
        voice_id: p.voice_id,
        tenant_id: "",
        name: p.name,
        language: p.language,
        embedding_dim: 256,
        sample_duration_ms: 0,
        training_status: "training" as const,
      });
    }
  });

  // Pending voices appear at the top, server voices below
  const voices = [...pendingAsVoices, ...serverVoices];
  const trainedVoices = voices.filter((v) => v.training_status === "trained");

  return {
    voices,
    trainedVoices,
    isLoading: query.isLoading,
    refetch: query.refetch,
  };
}

export function useInvalidateVoices() {
  const client = useQueryClient();
  return () => client.invalidateQueries({ queryKey: VOICES_KEY });
}
