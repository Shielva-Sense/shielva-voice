"use client";

import { useState, useEffect, useCallback } from "react";
import { Check, ArrowLeft, Sparkles } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { notify } from "../lib/toast";
import Link from "next/link";
import "./plans.css";

// Metering routes are gateway-auth'd DB routes — they need the session cookie,
// host-scoped to the identity/gateway host, so they must be called there (not
// via voice.shielva.ai) or the cookie is never sent → 401.
const GATEWAY_BASE = process.env.NEXT_PUBLIC_IDENTITY_URL || "https://api.shielva.ai";

/* ─── Plan Definitions ─── */

interface PlanDef {
  key: string;
  name: string;
  recommended: boolean;
  monthlyPrice: number;
  annualPrice: number;       // total annual price
  annualMonthly: number;     // monthly equivalent when billed annually
  description: string;
  features: string[];
}

const PLANS: PlanDef[] = [
  {
    key: "Essential",
    name: "Essential",
    recommended: false,
    monthlyPrice: 50,
    annualPrice: 480,
    annualMonthly: 40,
    description:
      "Everything you need to get started with voice intelligence. Ideal for small teams and prototyping.",
    features: [
      "30,000 text characters / month",
      "10,000 voice minutes / month",
      "All 7 neural services",
      "Voice cloning & library",
      "Standard support",
    ],
  },
  {
    key: "Premium",
    name: "Premium",
    recommended: true,
    monthlyPrice: 280,
    annualPrice: 2688,
    annualMonthly: 224,
    description:
      "Unlimited processing power for scaling teams. Priority support and deep analytics included.",
    features: [
      "Unlimited text processing",
      "Unlimited voice minutes",
      "All 7 neural services",
      "Voice cloning & library",
      "Priority support",
      "Advanced analytics",
    ],
  },
  {
    key: "Ultra",
    name: "Ultra",
    recommended: false,
    monthlyPrice: 833,
    annualPrice: 9999,
    annualMonthly: 833,
    description:
      "Enterprise-grade voice intelligence with dedicated support, custom model training, and SLA guarantee.",
    features: [
      "Unlimited text processing",
      "Unlimited voice minutes",
      "All 7 neural services",
      "Voice cloning & library",
      "Dedicated account manager",
      "Custom model training",
      "SLA guarantee",
    ],
  },
];

/* ─── Usage Info Shape ─── */

interface UsageInfo {
  plan: string;
  quotas: { text_chars: number; voice_minutes: number };
  usage: { text_chars: number; voice_minutes: number };
}

/* ─── Component ─── */

export default function PlansPage() {
  const { user, isAuthenticated, login } = useAuth();
  const [billing, setBilling] = useState<"monthly" | "annually">("monthly");
  const [subscribing, setSubscribing] = useState<string | null>(null);
  const [usageInfo, setUsageInfo] = useState<UsageInfo | null>(null);
  const [remotePlans, setRemotePlans] = useState<PlanDef[] | null>(null);

  /* Fetch plans from API (fallback to static definitions) */
  useEffect(() => {
    const fetchPlans = async () => {
      try {
        const res = await fetch(`${GATEWAY_BASE}/amt/v1/metering/plans`, {
          credentials: "include",
        });
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data) && data.length > 0) {
            setRemotePlans(data);
          }
        }
      } catch {
        // Use static plans as fallback
      }
    };
    fetchPlans();
  }, []);

  /* Fetch usage info */
  const refreshUsage = useCallback(async () => {
    if (!isAuthenticated) return;
    try {
      const res = await fetch(`${GATEWAY_BASE}/amt/v1/metering/usage`, {
        credentials: "include",
      });
      if (res.ok) {
        const data = await res.json();
        setUsageInfo(data);
      }
    } catch {
      // Silently fail — usage section will just be hidden
    }
  }, [isAuthenticated]);

  useEffect(() => {
    refreshUsage();
  }, [refreshUsage]);

  const plans = remotePlans ?? PLANS;
  const currentPlan = usageInfo?.plan ?? null;

  /* Subscribe handler */
  const handleSubscribe = async (planKey: string) => {
    if (!isAuthenticated) {
      login();
      return;
    }
    setSubscribing(planKey);
    try {
      const res = await fetch(`${GATEWAY_BASE}/amt/v1/metering/subscribe`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan: planKey }),
      });
      if (res.ok) {
        notify.success("Subscription updated", `You are now on the ${planKey} plan.`);
        await refreshUsage();
      } else {
        const err = await res.json().catch(() => null);
        notify.error("Subscription failed", err?.detail || "Please try again later.");
      }
    } catch {
      notify.error("Network error", "Could not reach the subscription service.");
    } finally {
      setSubscribing(null);
    }
  };

  /* Format number with commas */
  const fmt = (n: number) => n.toLocaleString("en-US");

  /* Price display helpers */
  const getDisplayPrice = (plan: PlanDef) => {
    if (billing === "annually") {
      return plan.annualMonthly;
    }
    return plan.monthlyPrice;
  };

  const getOriginalPrice = (plan: PlanDef) => {
    if (billing === "annually" && plan.annualMonthly < plan.monthlyPrice) {
      return plan.monthlyPrice;
    }
    return null;
  };

  /* CTA label */
  const getCtaLabel = (planKey: string) => {
    if (!isAuthenticated) return "Subscribe";
    if (currentPlan === planKey) return "Current Plan";
    return `Get ${planKey}`;
  };

  const isCurrent = (planKey: string) => currentPlan === planKey;

  return (
    <div className="plans-page">
      {/* Back */}
      <Link href="/" className="plans-back">
        <ArrowLeft size={15} />
        Back to Dashboard
      </Link>

      {/* Header */}
      <div className="plans-header">
        <h1 className="plans-title">Shielva Voice Intelligence Plans</h1>
        <p className="plans-subtitle">
          Choose the plan that fits your voice processing needs.
        </p>
      </div>

      {/* Toggle */}
      <div className="plans-toggle-wrapper">
        <div className="plans-toggle">
          <button
            className={`plans-toggle-btn ${billing === "monthly" ? "active" : ""}`}
            onClick={() => setBilling("monthly")}
          >
            Monthly
          </button>
          <button
            className={`plans-toggle-btn ${billing === "annually" ? "active" : ""}`}
            onClick={() => setBilling("annually")}
          >
            Annually
          </button>
        </div>
        {billing === "annually" && (
          <span className="plans-save-badge">Save up to 20%</span>
        )}
      </div>

      {/* Plan Cards */}
      <div className="plans-grid">
        {plans.map((plan) => (
          <div
            key={plan.key}
            className={[
              "plan-card",
              plan.recommended ? "recommended" : "",
              isCurrent(plan.key) ? "current" : "",
            ]
              .filter(Boolean)
              .join(" ")}
          >
            {/* Name + Badge */}
            <div className="plan-name-row">
              <span className="plan-name">{plan.name}</span>
              {plan.recommended && (
                <span className="plan-badge">
                  <Sparkles
                    size={11}
                    style={{ display: "inline", verticalAlign: "-1px", marginRight: 3 }}
                  />
                  Recommended
                </span>
              )}
            </div>

            {/* Price */}
            <div className="plan-price">
              <span className="plan-price-current">${fmt(getDisplayPrice(plan))}</span>
              {getOriginalPrice(plan) && (
                <span className="plan-price-original">
                  ${fmt(getOriginalPrice(plan)!)}
                </span>
              )}
              <span className="plan-price-period">/ month</span>
            </div>

            {/* Billing note */}
            <div className="plan-billing-note">
              {billing === "annually"
                ? `Billed $${fmt(plan.annualPrice)} for 12 months`
                : "\u00A0"}
            </div>

            {/* Description */}
            <p className="plan-description">{plan.description}</p>

            {/* Features */}
            <ul className="plan-features">
              {plan.features.map((feat) => (
                <li key={feat} className="plan-feature">
                  <Check size={15} className="plan-feature-check" strokeWidth={2.5} />
                  <span>{feat}</span>
                </li>
              ))}
            </ul>

            {/* CTA */}
            <button
              className={`plan-cta ${
                subscribing === plan.key
                  ? "plan-cta-loading"
                  : isCurrent(plan.key)
                  ? "plan-cta-current"
                  : "plan-cta-active"
              }`}
              disabled={isCurrent(plan.key) || subscribing !== null}
              onClick={() => handleSubscribe(plan.key)}
            >
              {subscribing === plan.key ? "Processing..." : getCtaLabel(plan.key)}
            </button>
          </div>
        ))}
      </div>

      {/* Usage Section */}
      {isAuthenticated && usageInfo && (
        <div className="usage-section">
          <h2 className="usage-title">Current Usage</h2>
          <p className="usage-subtitle">
            {usageInfo.plan} plan &mdash; this billing cycle
          </p>
          <div className="usage-grid">
            {/* Text characters */}
            <div className="usage-card">
              <div className="usage-card-label">Text Characters</div>
              <div className="usage-bar">
                <div
                  className={`usage-fill ${
                    usageInfo.quotas.text_chars === -1 ? "usage-fill-unlimited" : ""
                  }`}
                  style={
                    usageInfo.quotas.text_chars === -1
                      ? undefined
                      : {
                          width: `${Math.min(
                            100,
                            (usageInfo.usage.text_chars /
                              usageInfo.quotas.text_chars) *
                              100
                          )}%`,
                        }
                  }
                />
              </div>
              <div className="usage-stats">
                <span>
                  <span className="usage-stats-value">
                    {fmt(usageInfo.usage.text_chars)}
                  </span>{" "}
                  /{" "}
                  {usageInfo.quotas.text_chars === -1
                    ? "Unlimited"
                    : fmt(usageInfo.quotas.text_chars)}{" "}
                  used
                </span>
              </div>
            </div>

            {/* Voice minutes */}
            <div className="usage-card">
              <div className="usage-card-label">Voice Minutes</div>
              <div className="usage-bar">
                <div
                  className={`usage-fill ${
                    usageInfo.quotas.voice_minutes === -1 ? "usage-fill-unlimited" : ""
                  }`}
                  style={
                    usageInfo.quotas.voice_minutes === -1
                      ? undefined
                      : {
                          width: `${Math.min(
                            100,
                            (usageInfo.usage.voice_minutes /
                              usageInfo.quotas.voice_minutes) *
                              100
                          )}%`,
                        }
                  }
                />
              </div>
              <div className="usage-stats">
                <span>
                  <span className="usage-stats-value">
                    {usageInfo.usage.voice_minutes.toLocaleString("en-US", {
                      maximumFractionDigits: 1,
                    })}
                  </span>{" "}
                  /{" "}
                  {usageInfo.quotas.voice_minutes === -1
                    ? "Unlimited"
                    : fmt(usageInfo.quotas.voice_minutes)}{" "}
                  used
                </span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
