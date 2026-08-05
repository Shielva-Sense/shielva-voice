# syntax=docker/dockerfile:1.7-labs
# shielva-voice-manager — voice.shielva.ai — Next.js 16 frontend, multi-stage.
#
# Public deps only (next, react, @tanstack/react-query, lucide-react, sonner,
# tailwind) → no .npmrc / private @shielva-ai registry auth needed. Uses npm to
# match the committed package-lock.json.
#
# 🚨 NEXT_PUBLIC_* are inlined at BUILD time (Next bakes them into the client
# bundle), and the devops flow-pipeline build node exposes NO build-args field
# — verified across the whole fleet. So the ARG DEFAULTS BELOW ARE WHAT SHIPS.
# Every default here must be the correct production value, not a dev
# placeholder: the app's own fallbacks point at localhost, so a missing or
# wrong default produces a build that cannot reach identity at all.
#
# To build against a different environment locally, override explicitly:
#   docker build \
#     --build-arg NEXT_PUBLIC_API_URL=https://amt.shielva.ai \
#     --build-arg NEXT_PUBLIC_IDENTITY_URL=https://api.shielva.ai \
#     --build-arg NEXT_PUBLIC_AUTH_URL=https://signin.shielva.ai \
#     -t shielva-voice-manager:dev .

FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

FROM node:22-bookworm-slim AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# ── Build-time public config (inlined into the client bundle) ──────────────────
# AMT host serving /amt/v1/synthesize + /amt/v1/transcribe.
ARG NEXT_PUBLIC_API_URL=https://amt.shielva.ai
# Gateway ROOT (no path suffix). AuthContext appends /identity/api/v1/unified/*
# onto it, so it must be the bare gateway origin.
ARG NEXT_PUBLIC_IDENTITY_URL=https://api.shielva.ai
# Sign-in UI host. voice.shielva.ai is a CUSTOMER-audience app (it carries the
# /plans billing flow), so it authenticates against signin.shielva.ai — NOT
# login.shielva.ai, which serves the internal/business audience and rejects
# customer accounts.
ARG NEXT_PUBLIC_AUTH_URL=https://signin.shielva.ai
# Public (unauthenticated) trial caps.
ARG NEXT_PUBLIC_PUBLIC_MAX_TEXT_CHARS=100
ARG NEXT_PUBLIC_PUBLIC_MAX_VOICE_SEC=5

ENV NEXT_TELEMETRY_DISABLED=1 NODE_ENV=production \
    NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL \
    NEXT_PUBLIC_IDENTITY_URL=$NEXT_PUBLIC_IDENTITY_URL \
    NEXT_PUBLIC_AUTH_URL=$NEXT_PUBLIC_AUTH_URL \
    NEXT_PUBLIC_PUBLIC_MAX_TEXT_CHARS=$NEXT_PUBLIC_PUBLIC_MAX_TEXT_CHARS \
    NEXT_PUBLIC_PUBLIC_MAX_VOICE_SEC=$NEXT_PUBLIC_PUBLIC_MAX_VOICE_SEC
RUN npm run build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
RUN groupadd --system appgroup && useradd --system --gid appgroup --shell /bin/false appuser
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3025 HOSTNAME=0.0.0.0
COPY --from=builder /app/.next             ./.next
COPY --from=builder /app/public            ./public
COPY --from=builder /app/package.json      ./package.json
COPY --from=builder /app/package-lock.json ./package-lock.json
COPY --from=builder /app/node_modules      ./node_modules
COPY --from=builder /app/next.config.ts    ./next.config.ts
RUN chown -R appuser:appgroup /app
USER appuser
EXPOSE 3025
HEALTHCHECK --interval=30s --timeout=3s --start-period=25s --retries=3 \
    CMD node -e "require('http').get('http://localhost:3025/',r=>process.exit(r.statusCode<500?0:1)).on('error',()=>process.exit(1))"
CMD ["node", "node_modules/next/dist/bin/next", "start", "--port", "3025", "--hostname", "0.0.0.0"]
