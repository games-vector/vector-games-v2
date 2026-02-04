#!/bin/bash
# Manual rollback script - allows rolling back to any previous version

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Get script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOY_DIR="$SCRIPT_DIR/deploy"
REGISTRY_FILE="$DEPLOY_DIR/version-registry.json"

# Check if registry exists
if [ ! -f "$REGISTRY_FILE" ]; then
    echo -e "${RED}❌ Error: Version registry not found!${NC}"
    echo -e "${YELLOW}📝 Run deploy.sh first to initialize version registry.${NC}"
    exit 1
fi

# Check if jq is available
if ! command -v jq &> /dev/null; then
    echo -e "${RED}❌ Error: jq is required for rollback functionality${NC}"
    echo -e "${YELLOW}📝 Install jq: sudo apt-get install jq${NC}"
    exit 1
fi

# Get current and previous versions
CURRENT_VERSION=$(jq -r '.current // "null"' "$REGISTRY_FILE")
PREVIOUS_VERSION=$(jq -r '.previous // "null"' "$REGISTRY_FILE")
HISTORY=$(jq -r '.history[]?.version // empty' "$REGISTRY_FILE" 2>/dev/null || echo "")

echo -e "${BLUE}╔══════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║         Vector Games V2 - Rollback Tool                 ║${NC}"
echo -e "${BLUE}╚══════════════════════════════════════════════════════════╝${NC}"
echo ""

if [ "$CURRENT_VERSION" != "null" ]; then
    echo -e "${GREEN}Current version: ${CURRENT_VERSION}${NC}"
else
    echo -e "${YELLOW}Current version: Not deployed${NC}"
fi

if [ "$PREVIOUS_VERSION" != "null" ]; then
    echo -e "${YELLOW}Previous version: ${PREVIOUS_VERSION}${NC}"
fi

echo ""

# Get available versions from Docker images
AVAILABLE_IMAGES=$(docker images vector-games-v2 --format "{{.Tag}}" | grep -v "^latest$" | sort -V -r || echo "")

if [ -z "$AVAILABLE_IMAGES" ]; then
    echo -e "${RED}❌ No versioned images found!${NC}"
    exit 1
fi

# Show available versions
echo -e "${BLUE}Available versions:${NC}"
VERSION_LIST=()
INDEX=1
for version in $AVAILABLE_IMAGES; do
    STATUS=""
    if [ "$version" = "$CURRENT_VERSION" ]; then
        STATUS="${GREEN}(current)${NC}"
    elif [ "$version" = "$PREVIOUS_VERSION" ]; then
        STATUS="${YELLOW}(previous)${NC}"
    fi
    
    echo -e "  ${INDEX}. ${version} ${STATUS}"
    VERSION_LIST+=("$version")
    INDEX=$((INDEX + 1))
done

echo ""

# Prompt for version selection
if [ "$PREVIOUS_VERSION" != "null" ]; then
    DEFAULT_CHOICE="1"
    echo -e "${YELLOW}Select version to rollback to [default: 1 (${PREVIOUS_VERSION})]:${NC} "
else
    DEFAULT_CHOICE=""
    echo -e "${YELLOW}Select version to rollback to:${NC} "
fi

read -r USER_CHOICE

# Use default if empty
if [ -z "$USER_CHOICE" ]; then
    if [ -n "$DEFAULT_CHOICE" ]; then
        USER_CHOICE="$DEFAULT_CHOICE"
    else
        echo -e "${RED}❌ No version selected${NC}"
        exit 1
    fi
fi

# Validate choice
if ! [[ "$USER_CHOICE" =~ ^[0-9]+$ ]] || [ "$USER_CHOICE" -lt 1 ] || [ "$USER_CHOICE" -gt "${#VERSION_LIST[@]}" ]; then
    echo -e "${RED}❌ Invalid selection${NC}"
    exit 1
fi

# Get selected version
SELECTED_VERSION="${VERSION_LIST[$((USER_CHOICE - 1))]}"
SELECTED_IMAGE="vector-games-v2:${SELECTED_VERSION}"

# Check if image exists
if ! docker images --format "{{.Repository}}:{{.Tag}}" | grep -q "^${SELECTED_IMAGE}$"; then
    echo -e "${RED}❌ Image not found: ${SELECTED_IMAGE}${NC}"
    exit 1
fi

# Confirm rollback
echo ""
echo -e "${YELLOW}⚠️  You are about to rollback to: ${SELECTED_VERSION}${NC}"
if [ "$CURRENT_VERSION" != "null" ]; then
    echo -e "${YELLOW}   Current version will be stopped${NC}"
fi
echo -e "${YELLOW}Continue? [y/N]:${NC} "
read -r CONFIRM

if [[ ! "$CONFIRM" =~ ^[Yy]$ ]]; then
    echo -e "${YELLOW}Rollback cancelled${NC}"
    exit 0
fi

# Perform rollback
echo ""
echo -e "${YELLOW}🔄 Rolling back to ${SELECTED_VERSION}...${NC}"

# Stop current containers
echo -e "${YELLOW}🛑 Stopping current containers...${NC}"
docker compose -f docker-compose.prod.yml --env-file .env.production down || true

# Start with selected version
echo -e "${YELLOW}🚀 Starting version ${SELECTED_VERSION}...${NC}"
IMAGE_TAG="$SELECTED_IMAGE" docker compose -f docker-compose.prod.yml --env-file .env.production up -d

# Wait for health check
echo -e "${YELLOW}⏳ Waiting for health check...${NC}"
sleep 10

MAX_WAIT=60
ELAPSED=0
HEALTH_PASSED=false

while [ $ELAPSED -lt $MAX_WAIT ]; do
    if curl -f http://localhost:3000/health > /dev/null 2>&1; then
        echo -e "${GREEN}✅ Health check passed!${NC}"
        HEALTH_PASSED=true
        break
    fi
    sleep 5
    ELAPSED=$((ELAPSED + 5))
    echo -n "."
done
echo ""

if [ "$HEALTH_PASSED" = true ]; then
    # Update version registry
    OLD_CURRENT="$CURRENT_VERSION"
    jq --arg version "$SELECTED_VERSION" \
       --arg timestamp "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" \
       --arg commit "$(git rev-parse HEAD 2>/dev/null || echo 'unknown')" \
       '.current = $version |
        .previous = (if .current != null and .current != $version then .current else .previous end)' \
       "$REGISTRY_FILE" > "$REGISTRY_FILE.tmp" && mv "$REGISTRY_FILE.tmp" "$REGISTRY_FILE"
    
    echo -e "${GREEN}✅ Rollback successful!${NC}"
    echo -e "${GREEN}📌 Now running version: ${SELECTED_VERSION}${NC}"
    if [ "$OLD_CURRENT" != "null" ]; then
        echo -e "${YELLOW}📌 Previous version: ${OLD_CURRENT}${NC}"
    fi
else
    echo -e "${RED}❌ Health check failed!${NC}"
    echo -e "${YELLOW}📋 Checking logs...${NC}"
    docker compose -f docker-compose.prod.yml --env-file .env.production logs --tail=50 app
    exit 1
fi
