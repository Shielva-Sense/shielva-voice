"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { listVoices, type VoiceInfo } from "../lib/amt-api";
import { listEngineVoices } from "../lib/voice-settings";
import { useAuth } from "../context/AuthContext";

export const VOICES_KEY = ["voices"] as const;

/**
 * Cloned voices for whichever engine the tenant selected.
 *
 * `useVoices` reads the cloud-GPU registry over `/amt/v1/voices`, which is not
 * deployed — so on a hosted engine the library rendered "0 voices / could not
 * be loaded" even right after a successful clone. A hosted vendor keeps the
 * account's own voices in a separate list from its public presets, so they
 * have to be asked for explicitly.
 */
export function useClonedVoices(engine: string | null): {
  voices: VoiceInfo[];
  isLoading: boolean;
  isError: boolean;
} {
  const { isAuthenticated, user } = useAuth();
  const isCloudGpu = !engine || engine === "shielva";
  const ready = isAuthenticated && !!user?.tenants?.[0];

  const gpu = useQuery({
    queryKey: VOICES_KEY,
    queryFn: async (): Promise<VoiceInfo[]> => (await listVoices()).voices,
    enabled: ready && isCloudGpu,
    staleTime: 30_000,
    retry: 0,
  });

  const hosted = useQuery({
    queryKey: ["engine-voices-owned", engine],
    queryFn: async (): Promise<VoiceInfo[]> => {
      const { voices } = await listEngineVoices(engine as string, { owned: true, limit: 100 });
      // Map the vendor's shape onto the library's — same fields the rows read.
      return voices.map((v) => ({
        voice_id: v.voice_id,
        tenant_id: "",
        name: v.name,
        language: v.language,
      }));
    },
    enabled: ready && !isCloudGpu && Boolean(engine),
    staleTime: 5 * 60 * 1000,
    retry: 0,
  });

  const q = isCloudGpu ? gpu : hosted;
  return { voices: q.data ?? [], isLoading: q.isLoading, isError: q.isError };
}

/**
 * List enrolled Chatterbox reference voices.
 *
 * `listVoices()` throws on a failed request (incl. the 404 the list endpoint
 * returns until the registry is wired). React Query keeps the last successful
 * data on error, so a failed refetch never wipes an optimistically-added voice;
 * a never-successful load surfaces as `isError` with an empty `voices` array,
 * which callers render as a graceful empty state.
 */
export function useVoices() {
  // The list is tenant-scoped via amtHeaders() (X-Tenant-Name), which AuthContext
  // populates only after /me resolves. Gate the query on the tenant being ready so
  // it doesn't fire anonymously on mount (→ empty list) and never refetch; React
  // Query runs it the moment auth settles.
  const { isAuthenticated, user } = useAuth();
  const ready = isAuthenticated && !!user?.tenants?.[0];
  const query = useQuery({
    queryKey: VOICES_KEY,
    queryFn: async (): Promise<VoiceInfo[]> => (await listVoices()).voices,
    enabled: ready,
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
