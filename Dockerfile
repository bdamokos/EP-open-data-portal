ARG NODE_IMAGE=node:26.12.0-bookworm-slim
FROM ${NODE_IMAGE} AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY index.html vite.config.ts tsconfig*.json ./
COPY THIRD_PARTY_JAVASCRIPT_LICENSES.txt ./
COPY src ./src
COPY public ./public
COPY server ./server
COPY scripts/stage-runtime.mjs ./scripts/stage-runtime.mjs
RUN npm run build && node scripts/stage-runtime.mjs /runtime-server

FROM ${NODE_IMAGE} AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force

FROM ${NODE_IMAGE} AS runtime
ARG APP_REVISION
LABEL org.opencontainers.image.title="Parliament explorer" \
      org.opencontainers.image.revision=${APP_REVISION}
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8790 APP_REVISION=${APP_REVISION} \
    ODP_CACHE_DIR=/data/cache ACTIVITY_INDEX_DIR=/data/index \
    ACTIVITY_INDEX_ENABLED=false
COPY --from=dependencies /app/node_modules ./node_modules
COPY --from=dependencies /app/package.json /app/package-lock.json ./
COPY --from=build /runtime-server ./server
COPY --from=build /app/src/speakerNames.mjs /app/src/groupVoiceTerms.mjs ./src/
COPY --from=build /app/dist ./dist
COPY THIRD_PARTY_NOTICES.md ./
RUN mkdir -p /data/cache /data/index && chown -R node:node /data
USER node
EXPOSE 8790
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:8790/healthz').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node","server/index.mjs"]
