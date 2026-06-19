ARG NODE_VERSION=22

# --- Client Build Stage ---
FROM node:${NODE_VERSION}-alpine AS client-builder
WORKDIR /client
COPY client/package.json client/package-lock.json ./
RUN npm ci
COPY client/ ./
RUN npm run build

# --- Server Build Stage ---
FROM node:${NODE_VERSION}-alpine AS server-builder
WORKDIR /server
COPY server/package.json server/package-lock.json ./
RUN npm ci
COPY server/tsconfig.json ./
COPY server/src/ ./src/
RUN npm run build

# --- Production Stage ---
FROM node:${NODE_VERSION}-alpine
WORKDIR /app
COPY --from=server-builder /server/dist ./dist
COPY --from=server-builder /server/node_modules ./node_modules
COPY --from=server-builder /server/package.json ./
COPY --from=client-builder /client/dist ./client/dist

EXPOSE 3000
CMD ["node", "dist/index.js"]
