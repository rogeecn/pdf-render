FROM node:20-alpine AS deps

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

# ---

FROM node:20-alpine

RUN apk add --no-cache tini

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY server ./server
COPY public ./public

RUN mkdir -p /app/ebooks /app/data && chown -R node:node /app

USER node

EXPOSE 3000

ENV DATA_DIR=/app/data
VOLUME ["/app/ebooks", "/app/data"]

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "server/index.js"]
