# ---- build stage: install deps + build frontend ----
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --no-audit --no-fund
COPY web ./web
COPY vite.config.js ./
RUN npx vite build

# ---- runtime stage ----
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json ./
COPY server ./server
COPY scripts ./scripts
COPY data/processed ./data/processed
COPY --from=build /app/dist ./dist
# data/app.db is created on first start by `node server/seed.js`
RUN npm install --omit=dev --no-audit --no-fund && npm cache clean --force
EXPOSE 3000
VOLUME ["/app/data"]
# seed only on first start (data volume persists app.db; re-seeding would wipe user imports)
CMD ["sh", "-c", "test -f data/app.db || node server/seed.js; node server/index.js"]
