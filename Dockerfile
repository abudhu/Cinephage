# ==========================================
# Build Stage
# ==========================================
FROM node:22-alpine3.21 AS builder

WORKDIR /app

# Install build tools required for native modules (better-sqlite3)
RUN apk add --no-cache python3 make g++

# Copy package files first to leverage Docker cache
COPY package*.json ./

# Install all dependencies (including devDependencies for building)
RUN npm ci

# Copy the rest of the application code
COPY . .

# Build the SvelteKit application
RUN npm run build

# ==========================================
# Runtime Stage
# ==========================================
FROM node:22-alpine3.21 AS runner

WORKDIR /app

# Install runtime dependencies (ffmpeg for ffprobe media analysis)
RUN apk add --no-cache ffmpeg

# Create app user with fixed UID/GID (can be overridden with docker --user)
RUN addgroup -g 1000 cinephage && \
    adduser -u 1000 -G cinephage -h /app -D cinephage

# Create necessary directories with correct ownership
RUN mkdir -p data logs && chown -R cinephage:cinephage data logs

# Copy production dependencies and built artifacts from builder
COPY --from=builder --chown=cinephage:cinephage /app/node_modules ./node_modules
COPY --from=builder --chown=cinephage:cinephage /app/build ./build
COPY --from=builder --chown=cinephage:cinephage /app/package.json ./package.json
COPY --from=builder --chown=cinephage:cinephage /app/src ./src

# Copy bundled indexers to separate location (not shadowed by volume mount)
COPY --from=builder --chown=cinephage:cinephage /app/data/indexers ./bundled-indexers

# Copy and set up entrypoint script
COPY --chown=cinephage:cinephage docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x ./docker-entrypoint.sh

# Set environment variables
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000
ENV FFPROBE_PATH=/usr/bin/ffprobe
ENV BROWSER_SOLVER_ENABLED=false

# Expose the application port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/api/health || exit 1

# Run as non-root user (rootless)
USER cinephage

# Start the application
ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["node", "build/index.js"]
