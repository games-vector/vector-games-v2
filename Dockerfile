# Multi-stage build for vector-games-v2 with game-platform-core from GitHub Packages

# Stage 1: Build vector-games-v2 application
FROM node:20-alpine AS builder
WORKDIR /app

# Configure npm for better network handling
RUN npm config set fetch-retries 5 && \
    npm config set fetch-retry-mintimeout 20000 && \
    npm config set fetch-retry-maxtimeout 120000

# Set up GitHub Packages registry
RUN echo "@games-vector:registry=https://npm.pkg.github.com" > .npmrc

# Set up GitHub Packages authentication
# GITHUB_TOKEN should be passed as build arg
ARG GITHUB_TOKEN
RUN if [ -n "$GITHUB_TOKEN" ]; then \
      echo "//npm.pkg.github.com/:_authToken=$GITHUB_TOKEN" >> .npmrc; \
    else \
      echo "Warning: GITHUB_TOKEN not provided. Package installation may fail."; \
    fi

# Copy package files (from vector-games-v2 directory)
COPY vector-games-v2/package*.json ./

# Install dependencies (will fetch @games-vector/game-core from GitHub Packages)
RUN npm ci --legacy-peer-deps || npm install --legacy-peer-deps

# Copy source code (from vector-games-v2 directory)
COPY vector-games-v2/ .

# Remove .npmrc from build (not needed in final image, and contains token)
RUN rm -f .npmrc

# Build the application
RUN npm run build

# Stage 3: Production runtime
FROM node:20-alpine AS runner
WORKDIR /app

# Configure npm for better network handling
RUN npm config set fetch-retries 5 && \
    npm config set fetch-retry-mintimeout 20000 && \
    npm config set fetch-retry-maxtimeout 120000

# Set up GitHub Packages registry for production dependencies
RUN echo "@games-vector:registry=https://npm.pkg.github.com" > .npmrc

# Set up GitHub Packages authentication
# GITHUB_TOKEN should be passed as build arg
ARG GITHUB_TOKEN
RUN if [ -n "$GITHUB_TOKEN" ]; then \
      echo "//npm.pkg.github.com/:_authToken=$GITHUB_TOKEN" >> .npmrc; \
    else \
      echo "Warning: GITHUB_TOKEN not provided. Package installation may fail."; \
    fi

# Copy built files
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package*.json ./

# Install production dependencies only
RUN npm ci --legacy-peer-deps --omit=dev || npm ci --legacy-peer-deps --omit=dev && npm cache clean --force

# Remove .npmrc after installation (contains token)
RUN rm -f .npmrc

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
