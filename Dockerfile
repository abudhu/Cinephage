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

# Install runtime dependencies
# - ffmpeg: required for ffprobe media analysis
# - shadow: for usermod/groupmod to change UID/GID
# - su-exec: for dropping privileges (lighter than gosu)
RUN apk add --no-cache ffmpeg shadow su-exec

# Create necessary directories
RUN mkdir -p data logs

# Copy production dependencies and built artifacts from builder
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/build ./build
COPY --from=builder /app/package.json ./package.json
# Note: drizzle folder no longer needed - schema sync is embedded in the app
COPY --from=builder /app/src ./src

# Copy bundled indexers to separate location (not shadowed by volume mount)
COPY --from=builder /app/data/indexers ./bundled-indexers

# Copy and set up entrypoint script
COPY docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x ./docker-entrypoint.sh

# Set environment variables
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000
ENV FFPROBE_PATH=/usr/bin/ffprobe
ENV BROWSER_SOLVER_ENABLED=false

# Default PUID/PGID (can be overridden at runtime)
ENV PUID=1000
ENV PGID=1000

# Expose the application port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/api/health || exit 1

# Start the application (entrypoint handles user switching)
ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["node", "build/index.js"]
