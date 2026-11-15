# syntax=docker/dockerfile:1

# ---- build the client (Vite) and bundle the server (esbuild) ----
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# ---- runtime: the Express + Socket.IO server, which also serves the built client ----
FROM node:22-alpine
ENV NODE_ENV=production \
    NODE_NO_WARNINGS=1 \
    PORT=3000
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD wget -qO- "http://127.0.0.1:${PORT}/api/health" >/dev/null || exit 1
CMD ["node", "dist/server/index.js"]
