FROM node:20-slim

# Build tools for native Node.js addons (better-sqlite3) + sharp system libs
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 make g++ libvips-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY backend/package*.json ./

# Install production deps; sharp will use its prebuilt Debian x64 binary
RUN npm install -g npm@latest --quiet && npm install --omit=dev --prefer-offline

COPY backend/ .

EXPOSE 3000

# Log uncaught exceptions before crashing so Amvera captures the reason
ENV NODE_ENV=production

CMD ["node", "src/index.js"]
