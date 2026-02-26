# ============================================
# Backend Dockerfile
# ============================================
# Build context should be the project root.

FROM node:20-alpine

RUN apk add --no-cache python3 make musl-dev g++ sqlite-libs

WORKDIR /app
ENV NODE_ENV=production

RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

# Copy lock-aware manifests first for better layer caching.
COPY shared-types/package*.json ./shared-types/
COPY backend/package*.json ./

# Install dependencies with lockfiles.
RUN npm ci --include=dev && \
    cd shared-types && npm ci --include=dev

# Copy source files.
COPY shared-types/ ./shared-types/
COPY backend/ ./
COPY prompt-docs/ ./prompt-docs/
COPY ui-ux-data/ ./ui-ux-data/

# Build shared-types and expose it as local package.
RUN cd shared-types && npx tsc && \
    rm -rf /app/node_modules/@ai-frontend/shared-types && \
    mkdir -p /app/node_modules/@ai-frontend && \
    cp -r /app/shared-types /app/node_modules/@ai-frontend/shared-types && \
    cp package.json /app/node_modules/@ai-frontend/shared-types/

RUN mkdir -p /app/data && \
    chown -R nodejs:nodejs /app

USER nodejs

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3001/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

CMD ["node", "--import", "tsx", "src/server.ts"]

