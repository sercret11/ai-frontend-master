FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm config set fetch-retries 5 \
 && npm config set fetch-retry-factor 2 \
 && npm config set fetch-retry-mintimeout 20000 \
 && npm config set fetch-retry-maxtimeout 120000 \
 && npm config set fetch-timeout 300000 \
 && for attempt in 1 2 3; do \
      npm ci --no-audit && break; \
      echo "npm ci failed (attempt ${attempt}/3), retrying..."; \
      if [ "$attempt" = "3" ]; then exit 1; fi; \
      sleep $((attempt * 15)); \
    done

COPY . .
RUN npm run build

FROM node:20-alpine AS production

WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/server.js ./server.js

EXPOSE 5174

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:5174/', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

CMD ["node", "server.js"]
