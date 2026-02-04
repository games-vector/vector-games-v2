#!/bin/bash
# Auto-deployment script - polls git and deploys on new commits
# This script runs as a systemd service and checks for new commits every 2 minutes

set -e

# Configuration
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LAST_COMMIT_FILE="/tmp/vector-games-last-deployed-commit"
LOG_FILE="/var/log/vector-games-auto-deploy.log"
POLL_INTERVAL=120  # 2 minutes in seconds

# Colors for logging
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Logging function
log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

# Change to repo directory
cd "$REPO_DIR" || {
    log "${RED}❌ Error: Cannot access repository directory: $REPO_DIR${NC}"
    exit 1
}

# Ensure we're on main branch
git checkout main 2>/dev/null || true

# Fetch latest changes
log "${YELLOW}🔄 Fetching latest changes from origin...${NC}"
git fetch origin main 2>/dev/null || {
    log "${RED}❌ Error: Failed to fetch from origin${NC}"
    exit 1
}

# Get current commit on origin/main
CURRENT_COMMIT=$(git rev-parse origin/main 2>/dev/null || echo "")

if [ -z "$CURRENT_COMMIT" ]; then
    log "${RED}❌ Error: Cannot get current commit from origin/main${NC}"
    exit 1
fi

# Check if we have a last deployed commit
if [ -f "$LAST_COMMIT_FILE" ]; then
    LAST_COMMIT=$(cat "$LAST_COMMIT_FILE" 2>/dev/null || echo "")
    
    # If commit changed, deploy
    if [ "$CURRENT_COMMIT" != "$LAST_COMMIT" ] && [ -n "$LAST_COMMIT" ]; then
        log "${GREEN}📦 New commit detected: ${CURRENT_COMMIT:0:7}${NC}"
        log "${YELLOW}   Previous commit: ${LAST_COMMIT:0:7}${NC}"
        
        # Pull latest code
        log "${YELLOW}⬇️  Pulling latest code...${NC}"
        git pull origin main || {
            log "${RED}❌ Error: Failed to pull from origin${NC}"
            exit 1
        }
        
        # Fetch tags
        git fetch --tags 2>/dev/null || true
        
        # Run deployment
        log "${GREEN}🚀 Starting deployment...${NC}"
        if ./deploy.sh >> "$LOG_FILE" 2>&1; then
            # Save deployed commit
            echo "$CURRENT_COMMIT" > "$LAST_COMMIT_FILE"
            log "${GREEN}✅ Deployment completed successfully!${NC}"
        else
            log "${RED}❌ Deployment failed! Check logs above.${NC}"
            exit 1
        fi
    else
        # No change, just log (quiet mode after first run)
        if [ -z "$LAST_COMMIT" ]; then
            # First run - just save current commit
            echo "$CURRENT_COMMIT" > "$LAST_COMMIT_FILE"
            log "${GREEN}✅ Initialized. Current commit: ${CURRENT_COMMIT:0:7}${NC}"
        fi
    fi
else
    # First run - initialize
    echo "$CURRENT_COMMIT" > "$LAST_COMMIT_FILE"
    log "${GREEN}✅ Auto-deploy initialized. Current commit: ${CURRENT_COMMIT:0:7}${NC}"
fi

exit 0
