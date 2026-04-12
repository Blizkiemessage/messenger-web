FROM node:20-slim

# sharp requires these system libs on Debian slim
RUN apt-get update && apt-get install -y --no-install-recommends \
      libvips-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY backend/package*.json ./

# Install production deps; sharp will use its prebuilt Debian x64 binary
RUN npm install --production --prefer-offline

COPY backend/ .

EXPOSE 3000

# Log uncaught exceptions before crashing so Amvera captures the reason
ENV NODE_ENV=production

CMD ["node", "src/index.js"]
