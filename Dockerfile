FROM node:20-slim

# Build tools for native Node.js addons (better-sqlite3) + sharp system libs
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 make g++ libvips-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY backend/package*.json ./

# Install production deps; sharp will use its prebuilt Debian x64 binary.
# Do NOT `npm install -g npm@latest` here — npm's own engine requirement can
# (and did, 2026-07-09) outpace the pinned Node 20 base image, breaking every
# build. The npm bundled with node:20-slim is sufficient for a plain install.
RUN npm install --omit=dev --prefer-offline

COPY backend/ .

EXPOSE 3000

# Log uncaught exceptions before crashing so Amvera captures the reason
ENV NODE_ENV=production

CMD ["node", "src/index.js"]
