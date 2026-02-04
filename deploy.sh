#!/bin/bash

set -e

echo "🚀 Starting Vector Games V2 deployment..."

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if .env.production exists
if [ ! -f .env.production ]; then
    echo -e "${RED}❌ Error: .env.production file not found!${NC}"
    echo -e "${YELLOW}📝 Please create .env.production file with your configuration.${NC}"
    echo -e "${YELLOW}📝 You can copy env.production.template and modify it.${NC}"
    exit 1
fi

# Check if GITHUB_TOKEN is set (either in .env.production or as environment variable)
if [ -z "$GITHUB_TOKEN" ] && ! grep -q "^GITHUB_TOKEN=" .env.production 2>/dev/null; then
    echo -e "${YELLOW}⚠️  Warning: GITHUB_TOKEN not found in .env.production or environment${NC}"
    echo -e "${YELLOW}📝 The build will try to use .npmrc from build context if available${NC}"
    echo -e "${YELLOW}📝 For better security, add GITHUB_TOKEN to .env.production:${NC}"
    echo -e "${YELLOW}   GITHUB_TOKEN=ghp_your_token_here${NC}"
    echo ""
fi

# Check if Docker is installed
if ! command -v docker &> /dev/null; then
    echo -e "${RED}❌ Error: Docker is not installed!${NC}"
    exit 1
fi

# Check if Docker Compose is installed
if ! docker compose version &> /dev/null; then
    echo -e "${RED}❌ Error: Docker Compose is not installed!${NC}"
    exit 1
fi

# Check if game-platform-core exists
if [ ! -d "../game-platform-core" ]; then
    echo -e "${RED}❌ Error: game-platform-core directory not found!${NC}"
    echo -e "${YELLOW}📝 Expected location: ../game-platform-core${NC}"
    echo -e "${YELLOW}📝 Please ensure game-platform-core is in the parent directory.${NC}"
    exit 1
fi

echo -e "${GREEN}✅ Prerequisites check passed${NC}"

# Verify game-platform-core exists (Docker will build it)
echo -e "${YELLOW}📦 Verifying game-platform-core...${NC}"
if [ ! -d "../game-platform-core" ]; then
    echo -e "${RED}❌ Error: game-platform-core directory not found!${NC}"
    echo -e "${YELLOW}📝 Expected location: ../game-platform-core${NC}"
    echo -e "${YELLOW}📝 Please ensure game-platform-core is in the parent directory.${NC}"
    exit 1
fi

if [ ! -f "../game-platform-core/package.json" ]; then
    echo -e "${RED}❌ Error: game-platform-core/package.json not found!${NC}"
    exit 1
fi

echo -e "${GREEN}✅ game-platform-core found - Docker will build it during image build${NC}"

# ============================================================================
# VERSION DETECTION AND MANAGEMENT
# ============================================================================

# Get script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOY_DIR="$SCRIPT_DIR/deploy"
mkdir -p "$DEPLOY_DIR"

# Initialize version registry if it doesn't exist
REGISTRY_FILE="$DEPLOY_DIR/version-registry.json"
if [ ! -f "$REGISTRY_FILE" ]; then
    echo '{"current": null, "previous": null, "history": []}' > "$REGISTRY_FILE"
fi

# Detect version from git tag or commit hash
if git describe --tags --exact-match HEAD 2>/dev/null; then
    VERSION=$(git describe --tags --exact-match HEAD)
    echo -e "${GREEN}📌 Detected git tag: ${VERSION}${NC}"
else
    VERSION="commit-$(git rev-parse --short HEAD)"
    echo -e "${YELLOW}📌 No git tag found, using commit hash: ${VERSION}${NC}"
fi

# Get current version from registry
CURRENT_VERSION=$(jq -r '.current // "null"' "$REGISTRY_FILE" 2>/dev/null || echo "null")
PREVIOUS_VERSION=$(jq -r '.previous // "null"' "$REGISTRY_FILE" 2>/dev/null || echo "null")

# Check if this version is already deployed
if [ "$VERSION" = "$CURRENT_VERSION" ] && [ "$CURRENT_VERSION" != "null" ]; then
    echo -e "${YELLOW}⚠️  Version ${VERSION} is already deployed. Skipping deployment.${NC}"
    echo -e "${YELLOW}💡 To force redeploy, remove the version from registry or use a new tag.${NC}"
    exit 0
fi

# Set image tag
IMAGE_TAG="vector-games-v2:${VERSION}"
export IMAGE_TAG

echo -e "${GREEN}📦 Image will be tagged as: ${IMAGE_TAG}${NC}"

# Stop existing containers
echo -e "${YELLOW}🛑 Stopping existing containers...${NC}"
docker compose -f docker-compose.prod.yml --env-file .env.production down || true

# Load GITHUB_TOKEN from .env.production if not already set
if [ -z "$GITHUB_TOKEN" ] && [ -f .env.production ]; then
    GITHUB_TOKEN=$(grep "^GITHUB_TOKEN=" .env.production 2>/dev/null | cut -d '=' -f2- | sed 's/^["'\'']//;s/["'\'']$//' | xargs)
    if [ -n "$GITHUB_TOKEN" ]; then
        export GITHUB_TOKEN
        echo -e "${GREEN}✅ Loaded GITHUB_TOKEN from .env.production${NC}"
    fi
fi

# Build and tag Docker image
echo -e "${YELLOW}🔨 Building Docker image with tag ${IMAGE_TAG}...${NC}"
docker build \
    --build-arg GITHUB_TOKEN="${GITHUB_TOKEN:-}" \
    -t "$IMAGE_TAG" \
    -f Dockerfile \
    ..

# Also tag as latest for convenience
docker tag "$IMAGE_TAG" "vector-games-v2:latest"

# Build and start services (will use the tagged image)
echo -e "${YELLOW}🚀 Starting services with version ${VERSION}...${NC}"
IMAGE_TAG="$IMAGE_TAG" docker compose -f docker-compose.prod.yml --env-file .env.production up -d

# Wait for services to be healthy
echo -e "${YELLOW}⏳ Waiting for services to be healthy...${NC}"

# Wait for MySQL and Redis to be healthy
echo -e "${YELLOW}   Waiting for MySQL and Redis...${NC}"
max_wait=60
elapsed=0
while [ $elapsed -lt $max_wait ]; do
    mysql_status=$(docker inspect --format='{{.State.Health.Status}}' vector-games-mysql 2>/dev/null || echo "unknown")
    redis_status=$(docker inspect --format='{{.State.Health.Status}}' vector-games-redis 2>/dev/null || echo "unknown")
    
    if [ "$mysql_status" = "healthy" ] && [ "$redis_status" = "healthy" ]; then
        echo -e "${GREEN}   ✅ MySQL and Redis are healthy${NC}"
        break
    fi
    sleep 2
    elapsed=$((elapsed + 2))
    echo -n "."
done
echo ""

# Wait for app container to be running
echo -e "${YELLOW}   Waiting for app container to start...${NC}"
max_wait=30
elapsed=0
while [ $elapsed -lt $max_wait ]; do
    if docker ps | grep -q vector-games-backend; then
        echo -e "${GREEN}   ✅ App container is running${NC}"
        break
    fi
    sleep 2
    elapsed=$((elapsed + 2))
    echo -n "."
done
echo ""

# Wait for app health check
echo -e "${YELLOW}   Waiting for app health check (this may take up to 90 seconds)...${NC}"
max_wait=90
elapsed=0
health_passed=false

while [ $elapsed -lt $max_wait ]; do
    # Check if container is running
    if ! docker ps | grep -q vector-games-backend; then
        echo -e "\n${RED}❌ App container stopped!${NC}"
        echo -e "${YELLOW}📋 Checking logs...${NC}"
        docker compose -f docker-compose.prod.yml --env-file .env.production logs --tail=50 app
        health_passed=false
        break
    fi
    
    # Check health status
    health_status=$(docker inspect --format='{{.State.Health.Status}}' vector-games-backend 2>/dev/null || echo "starting")
    
    if [ "$health_status" = "healthy" ]; then
        echo -e "\n${GREEN}   ✅ App is healthy!${NC}"
        health_passed=true
        break
    elif [ "$health_status" = "unhealthy" ]; then
        echo -e "\n${RED}❌ App health check failed!${NC}"
        echo -e "${YELLOW}📋 Checking logs...${NC}"
        docker compose -f docker-compose.prod.yml --env-file .env.production logs --tail=50 app
        health_passed=false
        break
    fi
    
    sleep 5
    elapsed=$((elapsed + 5))
    echo -n "."
done
echo ""

# Final check
if [ "$health_passed" = false ]; then
    echo -e "${YELLOW}⚠️  Health check timeout, but checking if app is responding...${NC}"
    
    # Try to hit the health endpoint directly
    sleep 2
    if curl -f http://localhost:3000/health > /dev/null 2>&1; then
        echo -e "${GREEN}✅ App is responding on /health endpoint!${NC}"
        health_passed=true
    else
        echo -e "${YELLOW}⚠️  Health endpoint not responding, but container is running${NC}"
        echo -e "${YELLOW}📋 Checking logs...${NC}"
        docker compose -f docker-compose.prod.yml --env-file .env.production logs --tail=30 app
    fi
fi

# ============================================================================
# AUTO-ROLLBACK ON HEALTH CHECK FAILURE
# ============================================================================

if [ "$health_passed" = false ]; then
    echo -e "\n${RED}❌ Health check failed! Attempting automatic rollback...${NC}"
    
    if [ "$PREVIOUS_VERSION" != "null" ] && [ -n "$PREVIOUS_VERSION" ]; then
        echo -e "${YELLOW}🔄 Rolling back to previous version: ${PREVIOUS_VERSION}${NC}"
        
        # Stop current container
        docker compose -f docker-compose.prod.yml --env-file .env.production down || true
        
        # Deploy previous version
        PREV_IMAGE_TAG="vector-games-v2:${PREVIOUS_VERSION}"
        if docker images --format "{{.Repository}}:{{.Tag}}" | grep -q "^${PREV_IMAGE_TAG}$"; then
            echo -e "${GREEN}✅ Previous version image found: ${PREV_IMAGE_TAG}${NC}"
            IMAGE_TAG="$PREV_IMAGE_TAG" docker compose -f docker-compose.prod.yml --env-file .env.production up -d
            
            # Wait a bit and check health
            sleep 10
            if curl -f http://localhost:3000/health > /dev/null 2>&1; then
                echo -e "${GREEN}✅ Rollback successful! Running version: ${PREVIOUS_VERSION}${NC}"
                
                # Update registry to reflect rollback
                jq --arg version "$PREVIOUS_VERSION" \
                   '.current = $version' \
                   "$REGISTRY_FILE" > "$REGISTRY_FILE.tmp" && mv "$REGISTRY_FILE.tmp" "$REGISTRY_FILE"
                
                exit 0
            else
                echo -e "${RED}❌ Rollback failed! Previous version also unhealthy.${NC}"
                exit 1
            fi
        else
            echo -e "${RED}❌ Previous version image not found: ${PREV_IMAGE_TAG}${NC}"
            echo -e "${YELLOW}💡 Cannot rollback. Manual intervention required.${NC}"
            exit 1
        fi
    else
        echo -e "${RED}❌ No previous version available for rollback.${NC}"
        exit 1
    fi
fi

# Show final status
echo -e "${GREEN}📊 Container status:${NC}"
docker compose -f docker-compose.prod.yml --env-file .env.production ps

if [ "$health_passed" = true ] || docker ps | grep -q vector-games-backend; then
    echo -e "${GREEN}✅ Application deployment completed!${NC}"
    
    # ============================================================================
    # UPDATE VERSION REGISTRY
    # ============================================================================
    
    echo -e "${YELLOW}📝 Updating version registry...${NC}"
    
    # Get current timestamp and commit
    TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
    COMMIT=$(git rev-parse HEAD)
    
    # Update registry using jq (if available) or simple JSON manipulation
    if command -v jq &> /dev/null; then
        jq --arg version "$VERSION" \
           --arg timestamp "$TIMESTAMP" \
           --arg commit "$COMMIT" \
           '.current = $version |
            .previous = (if .current != null and .current != $version then .current else .previous end) |
            .history = ([.history[]? | select(.version != $version)] + [{
              version: $version,
              timestamp: $timestamp,
              commit: $commit
            }] | sort_by(.timestamp) | reverse | .[0:3])' \
           "$REGISTRY_FILE" > "$REGISTRY_FILE.tmp" && mv "$REGISTRY_FILE.tmp" "$REGISTRY_FILE"
    else
        # Fallback: simple JSON update (basic implementation)
        echo -e "${YELLOW}⚠️  jq not found, using basic registry update${NC}"
        cat > "$REGISTRY_FILE" <<EOF
{
  "current": "$VERSION",
  "previous": "$CURRENT_VERSION",
  "history": [
    {"version": "$VERSION", "timestamp": "$TIMESTAMP", "commit": "$COMMIT"}
  ]
}
EOF
    fi
    
    echo -e "${GREEN}✅ Version registry updated: current=${VERSION}, previous=${CURRENT_VERSION}${NC}"
    
    # ============================================================================
    # CLEANUP OLD VERSIONS (Keep last 3)
    # ============================================================================
    
    echo -e "${YELLOW}🧹 Cleaning up old versions (keeping last 3)...${NC}"
    
    if command -v jq &> /dev/null; then
        # Get versions to keep
        KEEP_VERSIONS=$(jq -r '.history[0:3][].version' "$REGISTRY_FILE" 2>/dev/null || echo "")
        
        # Get all vector-games-v2 images
        ALL_IMAGES=$(docker images vector-games-v2 --format "{{.Tag}}" | grep -v "^latest$" || true)
        
        REMOVED_COUNT=0
        for tag in $ALL_IMAGES; do
            if [ -n "$KEEP_VERSIONS" ] && echo "$KEEP_VERSIONS" | grep -q "^$tag$"; then
                continue  # Keep this version
            fi
            
            # Remove old version
            if docker rmi "vector-games-v2:$tag" 2>/dev/null; then
                echo -e "${YELLOW}   🗑️  Removed old version: $tag${NC}"
                REMOVED_COUNT=$((REMOVED_COUNT + 1))
            fi
        done
        
        if [ $REMOVED_COUNT -gt 0 ]; then
            echo -e "${GREEN}✅ Cleaned up $REMOVED_COUNT old version(s)${NC}"
        else
            echo -e "${GREEN}✅ No old versions to clean up${NC}"
        fi
    else
        echo -e "${YELLOW}⚠️  jq not found, skipping automatic cleanup${NC}"
    fi
    
    # Show current versions
    echo -e "${GREEN}📦 Current Docker images:${NC}"
    docker images vector-games-v2 --format "table {{.Repository}}\t{{.Tag}}\t{{.CreatedAt}}\t{{.Size}}"
    
else
    echo -e "${RED}❌ Application may not be fully healthy. Check logs above.${NC}"
    exit 1
fi

# Clean up package file (optional, can be kept for faster rebuilds)
# rm -f vector-games-game-core-*.tgz

echo -e "${GREEN}🎉 Deployment completed successfully!${NC}"
echo -e "${GREEN}📌 Deployed version: ${VERSION}${NC}"
echo -e "${YELLOW}📝 To view logs: docker compose -f docker-compose.prod.yml --env-file .env.production logs -f app${NC}"
echo -e "${YELLOW}🛑 To stop: docker compose -f docker-compose.prod.yml --env-file .env.production down${NC}"
echo -e "${YELLOW}🔄 To rollback: ./rollback.sh${NC}"
