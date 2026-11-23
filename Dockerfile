FROM node:22-bookworm-slim
WORKDIR /app
COPY package*.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci
COPY apps ./apps
COPY packages ./packages
# The deployment checkout can be readable only by its owner.
RUN npm run build && npm prune --omit=dev \
    && chmod -R a+rX apps packages && chmod a+r package.json
USER node
CMD ["node", "apps/api/src/server.js"]
