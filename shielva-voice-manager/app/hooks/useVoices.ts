"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { listVoices, type VoiceInfo } from "../lib/amt-api";

export const VOICES_KEY = ["voices"] as const;

/**
 * List enrolled IndicF5 reference voices.
 *
 * `listVoices()` throws on a failed request (incl. the 404 the list endpoint
 * returns until the registry is wired). React Query keeps the last successful
 * data on error, so a failed refetch never wipes an optimistically-added voice;
 * a never-successful load surfaces as `isError` with an empty `voices` array,
 * which callers render as a graceful empty state.
 */
export function useVoices() {
  const query = useQuery({
    queryKey: VOICES_KEY,
    queryFn: async (): Promise<VoiceInfo[]> => (await listVoices()).voices,
    staleTime: 30_000,
    retry: 0,
  });

  return {
    voices: query.data ?? [],
    isLoading: query.isLoading,
    isError: query.isError,
    refetch: query.refetch,
  };
}

export function useInvalidateVoices() {
  const client = useQueryClient();
  return () => client.invalidateQueries({ queryKey: VOICES_KEY });
}

/** Merge a newly enrolled voice into the cache so it appears immediately. */
export function useUpsertVoice() {
  const client = useQueryClient();
  return (voice: VoiceInfo) =>
    client.setQueryData<VoiceInfo[]>(VOICES_KEY, (old) => {
      const list = old ?? [];
      return list.some((v) => v.voice_id === voice.voice_id) ? list : [voice, ...list];
    });
}
