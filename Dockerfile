FROM node:22-bookworm-slim
WORKDIR /app
COPY package*.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci
COPY apps ./apps
RUN npm run build && npm prune --omit=dev
USER node
CMD ["node", "apps/api/src/server.js"]
