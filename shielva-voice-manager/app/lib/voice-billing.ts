// Tenant-facing voice usage / billing client.
//
// Voice is now metered as *voice credits* (a $100 top-up grants 8,000,000 credits)
// rather than a plan the user picks. This module owns:
//   - the top-up SKU/price/grant constant,
//   - deriving the tenant's credit balance + voice-agent status from data the
//     voice-manager already has,
//   - the tenant self-serve top-up POST.
//
// IMPORTANT (data source): the authoritative voice-credit ledger lives in
// subscription-management and is currently only exposed via the SUPERADMIN ops
// route `GET /billing/api/v1/ops/voice/metering`. A tenant app must NOT call that
// superadmin endpoint. No tenant-scoped `GET /billing/api/v1/voice/usage` exists
// yet, so until one does we derive the balance from the tenant's already-fetched
// voice quota (`/amt/v1/metering/usage`, surfaced on `useAuth().usageInfo`).
// See the TODOs below for exactly where the real tenant-scoped reads should land.

import type { UsageInfo } from "../context/AuthContext";

// Gateway-auth'd billing routes require the Shielva session cookie, which is
// host-scoped to the identity/gateway host — mirror the amt-api convention.
const GATEWAY_BASE = process.env.NEXT_PUBLIC_IDENTITY_URL || "https://api.shielva.ai";

/** The single self-serve top-up: $100 → +8,000,000 voice credits. */
export const VOICE_TOPUP = {
  sku: "voice-credits-8m",
  priceUsd: 100,
  grantsCredits: 8_000_000,
} as const;

export interface VoiceCredits {
  /** Total credits granted this cycle. `-1` when voice is bundled with the plan (unlimited). */
  granted: number;
  /** Credits consumed this cycle. */
  consumed: number;
  /** Credits remaining. `-1` when unlimited. */
  remaining: number;
  /** True when the tenant's plan bundles voice with no metered cap (e.g. the Ultra business plan). */
  unlimited: boolean;
}

/**
 * Derive the tenant's voice-credit balance from the voice quota the voice-manager
 * already fetched (`useAuth().usageInfo`).
 *
 * TODO(voice-billing): replace this derivation with a real tenant-scoped read
 * `GET ${GATEWAY_BASE}/billing/api/v1/voice/usage` that returns the credit ledger
 * shape `{ credits: { granted, consumed, remaining } }`. That endpoint still needs
 * to be added in subscription-management (the superadmin `/ops/voice/metering`
 * returns the same shape but is superadmin-gated and must never be called here).
 * Until then the numbers below reflect the tenant's voice-minute quota, presented
 * as the credit balance.
 */
export function deriveVoiceCredits(usage: UsageInfo | null): VoiceCredits | null {
  if (!usage) return null;
  const grantedRaw = usage.quotas.voice_minutes;
  const consumed = Math.max(0, Math.round(usage.usage.voice_minutes));
  // -1 is the backend sentinel for "unlimited / included with plan".
  if (grantedRaw === -1) {
    return { granted: -1, consumed, remaining: -1, unlimited: true };
  }
  const granted = Math.max(0, Math.round(grantedRaw));
  return {
    granted,
    consumed,
    remaining: Math.max(0, granted - consumed),
    unlimited: false,
  };
}

export type VoiceAgentStatus = "included" | "active" | "depleted" | "inactive";

/**
 * Derive whether the tenant's voice agent is usable.
 *
 * TODO(voice-billing): replace with a tenant-scoped entitlement flag from
 * subscription-management. The superadmin `/ops/voice/metering` exposes
 * `voice_agents.allowed_tenants` globally (a fleet count) and must NOT be called
 * from this tenant-facing app — a tenant only needs to know its own status.
 */
export function deriveVoiceAgentStatus(usage: UsageInfo | null): VoiceAgentStatus {
  const credits = deriveVoiceCredits(usage);
  if (!credits) return "inactive";
  if (credits.unlimited) return "included";
  return credits.remaining > 0 ? "active" : "depleted";
}

export interface TopupResult {
  tenant_id: string;
  voice_credits_remaining: number;
}

/**
 * Initiate the tenant self-serve voice-credit top-up ($100 → +8,000,000 credits).
 *
 * TODO(voice-billing): this targets a tenant self-serve endpoint that
 * subscription-management still needs to expose
 * (`POST ${GATEWAY_BASE}/billing/api/v1/voice/topups/self`). It mirrors the
 * superadmin `POST /billing/api/v1/ops/voice/topups` but is scoped to the caller's
 * OWN tenant via the session cookie — the superadmin ops endpoint must never be
 * called from this app. There is no pre-existing payment/checkout flow in the
 * voice-manager to reuse (verified), so we initiate the top-up via the billing
 * gateway directly; swap in a real checkout redirect here if one is added later.
 */
export async function purchaseVoiceTopup(tenantId: string): Promise<TopupResult> {
  const res = await fetch(`${GATEWAY_BASE}/billing/api/v1/voice/topups/self`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tenant_id: tenantId, sku: VOICE_TOPUP.sku }),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => null)) as { detail?: string } | null;
    throw new Error(err?.detail || "Top-up could not be completed.");
  }
  return res.json() as Promise<TopupResult>;
}
