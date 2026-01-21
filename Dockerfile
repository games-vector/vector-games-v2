# Multi-stage build for vector-games-v2 with game-platform-core package

# Stage 1: Build game-platform-core package
FROM node:20-alpine AS core-builder
WORKDIR /app/core

# Copy game-platform-core source from parent directory
# Note: Docker build context is set to parent directory in docker-compose
COPY game-platform-core/package*.json ./
COPY game-platform-core/tsconfig.json ./
COPY game-platform-core/src ./src

# Build the package (use --legacy-peer-deps to handle peer dependency conflicts)
RUN npm ci --legacy-peer-deps || npm install --legacy-peer-deps
RUN npm run build

# Package it as .tgz
RUN npm pack

# Stage 2: Build vector-games-v2 application
FROM node:20-alpine AS builder
WORKDIR /app

# Configure npm for better network handling
RUN npm config set fetch-retries 5 && \
    npm config set fetch-retry-mintimeout 20000 && \
    npm config set fetch-retry-maxtimeout 120000

# Copy package files (from vector-games-v2 directory)
COPY vector-games-v2/package*.json ./

# Copy the built game-platform-core package from previous stage
# Find the exact filename from the core-builder stage
COPY --from=core-builder /app/core/vector-games-game-core-*.tgz ./temp-package.tgz

# Create the directory structure that package.json expects
# package.json references: file:../game-platform-core/vector-games-game-core-1.0.0.tgz
# From /app, this resolves to /game-platform-core/vector-games-game-core-1.0.0.tgz
# We need to get the actual filename from the copied file
RUN mkdir -p /game-platform-core && \
    PACKAGE_NAME=$(ls ./temp-package.tgz 2>/dev/null | head -n1) && \
    if [ -f "./temp-package.tgz" ]; then \
        cp ./temp-package.tgz /game-platform-core/vector-games-game-core-1.0.0.tgz; \
    else \
        echo "Error: temp-package.tgz not found"; \
        exit 1; \
    fi && \
    ls -lh /game-platform-core/

# Install dependencies (use npm install instead of npm ci to avoid strict integrity checks on local files)
RUN npm install --legacy-peer-deps

# Copy source code (from vector-games-v2 directory)
COPY vector-games-v2/ .

# Build the application
RUN npm run build

# Stage 3: Production runtime
FROM node:20-alpine AS runner
WORKDIR /app

# Copy built files
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package*.json ./

# Configure npm for better network handling
RUN npm config set fetch-retries 5 && \
    npm config set fetch-retry-mintimeout 20000 && \
    npm config set fetch-retry-maxtimeout 120000

# Install production dependencies only
RUN npm ci --legacy-peer-deps --omit=dev || npm ci --legacy-peer-deps --omit=dev && npm cache clean --force

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=40s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# Print image size info
RUN echo "=== Image Size Info ===" && \
    du -sh /app && \
    du -sh /app/* && \
    df -h /

# Run the application
CMD ["node", "dist/main.js"]
