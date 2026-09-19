# syntax=docker/dockerfile:1.7
# VeraWallet FE (Next.js 16) 운영 이미지. `output: "standalone"`로 서버 실행에 필요한 파일만 담는다.
#
# NEXT_PUBLIC_* 값은 빌드 시점에 번들에 인라인된다. 따라서 이 두 값은 compose의 build.args로 들어와야 하고,
# 바꾸면 이미지를 다시 빌드해야 한다(런타임 env만 바꿔서는 클라이언트 번들이 모른다).
# 빌드 컨텍스트에 .env.local이 없도록 .dockerignore가 막는다 — 개발용 값이 운영 번들에 섞이지 않게.

FROM node:22-bookworm-slim AS base
RUN npm install -g pnpm@10.30.3
ENV CI=true \
    NEXT_TELEMETRY_DISABLED=1
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --store-dir /pnpm/store

FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ARG NEXT_PUBLIC_OMNIONE_CX_AUTH_URL=
ARG NEXT_PUBLIC_OMNIONE_CX_MOCK=
ENV NEXT_PUBLIC_OMNIONE_CX_AUTH_URL=$NEXT_PUBLIC_OMNIONE_CX_AUTH_URL \
    NEXT_PUBLIC_OMNIONE_CX_MOCK=$NEXT_PUBLIC_OMNIONE_CX_MOCK \
    NEXT_OUTPUT=standalone
RUN pnpm build

FROM node:22-bookworm-slim AS runner
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3100 \
    HOSTNAME=0.0.0.0
WORKDIR /app
COPY --from=builder --chown=node:node /app/public ./public
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
USER node
EXPOSE 3100
CMD ["node", "server.js"]
