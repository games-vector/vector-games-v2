#!/bin/bash

# =============================================================================
# CoinFlip Game Launch Script
# =============================================================================
# This script starts both the backend API and frontend UI for the CoinFlip game.
#
# Usage:
#   ./start-coinflip.sh                        # Start with default userId (prompts for input)
#   ./start-coinflip.sh --userId=<id>          # Start with specific userId
#   ./start-coinflip.sh --backend              # Start only backend
#   ./start-coinflip.sh --frontend             # Start only frontend (assumes backend running)
#   ./start-coinflip.sh --setup                # Only setup database, don't start services
#
# Default User ID: sxxurczuleogz19epayf
#
# Prerequisites:
#   - MySQL running on localhost:3306
#   - Redis running on localhost:6379
#   - Node.js 18+
#   - npm installed
# =============================================================================

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_PORT=3000
FRONTEND_PORT=8080
DB_NAME="vectorgames"
DUMP_FILE="$SCRIPT_DIR/dump/dump-stage.sql"

# User ID - will be set via input or argument
COINFLIP_USER_ID=""

# Parse arguments
START_BACKEND=true
START_FRONTEND=true
SETUP_ONLY=false

for arg in "$@"; do
    case $arg in
        --backend)
            START_FRONTEND=false
            ;;
        --frontend)
            START_BACKEND=false
            ;;
        --setup)
            SETUP_ONLY=true
            START_BACKEND=false
            START_FRONTEND=false
            ;;
        --userId=*)
            COINFLIP_USER_ID="${arg#*=}"
            ;;
    esac
done

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}   CoinFlip Game Launcher${NC}"
echo -e "${BLUE}========================================${NC}"

# Default User ID
DEFAULT_USER_ID="sxxurczuleogz19epayf"

# Prompt for userId if not provided via argument
if [ -z "$COINFLIP_USER_ID" ]; then
    echo ""
    echo -e "${YELLOW}Enter User ID (press Enter for default: ${DEFAULT_USER_ID}):${NC}"
    read -p "> " COINFLIP_USER_ID

    # Use default if empty
    if [ -z "$COINFLIP_USER_ID" ]; then
        COINFLIP_USER_ID="$DEFAULT_USER_ID"
    fi
fi

echo -e "\n${GREEN}Using User ID: $COINFLIP_USER_ID${NC}"

# Function to check if a command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Function to check if a service is running
check_service() {
    local host=$1
    local port=$2
    nc -z "$host" "$port" >/dev/null 2>&1
}

# Function to wait for service
wait_for_service() {
    local host=$1
    local port=$2
    local name=$3
    local max_attempts=30
    local attempt=0

    echo -n "Waiting for $name..."
    while ! check_service "$host" "$port"; do
        attempt=$((attempt + 1))
        if [ $attempt -ge $max_attempts ]; then
            echo -e " ${RED}FAILED${NC}"
            return 1
        fi
        echo -n "."
        sleep 1
    done
    echo -e " ${GREEN}OK${NC}"
    return 0
}

# Check prerequisites
echo -e "\n${YELLOW}Checking prerequisites...${NC}"

if ! command_exists node; then
    echo -e "${RED}Error: Node.js is not installed${NC}"
    exit 1
fi

if ! command_exists npm; then
    echo -e "${RED}Error: npm is not installed${NC}"
    exit 1
fi

NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
    echo -e "${RED}Error: Node.js 18+ required (current: $(node -v))${NC}"
    exit 1
fi
echo -e "Node.js: ${GREEN}$(node -v)${NC}"

# Check MySQL
echo -e "\n${YELLOW}Checking MySQL...${NC}"
if check_service localhost 3306; then
    echo -e "MySQL: ${GREEN}Running${NC}"
else
    echo -e "MySQL: ${RED}Not running${NC}"
    echo -e "${YELLOW}Attempting to start MySQL...${NC}"

    if command_exists brew; then
        brew services start mysql 2>/dev/null || true
        sleep 3
    fi

    if ! check_service localhost 3306; then
        echo -e "${RED}Error: Could not start MySQL. Please start it manually:${NC}"
        echo -e "  macOS: ${YELLOW}brew services start mysql${NC}"
        echo -e "  Linux: ${YELLOW}sudo systemctl start mysql${NC}"
        exit 1
    fi
    echo -e "MySQL: ${GREEN}Started${NC}"
fi

# Check Redis
echo -e "\n${YELLOW}Checking Redis...${NC}"
if check_service localhost 6379; then
    echo -e "Redis: ${GREEN}Running${NC}"
else
    echo -e "Redis: ${RED}Not running${NC}"
    echo -e "${YELLOW}Attempting to start Redis...${NC}"

    if command_exists brew; then
        brew services start redis 2>/dev/null || true
        sleep 2
    fi

    if ! check_service localhost 6379; then
        echo -e "${RED}Error: Could not start Redis. Please start it manually:${NC}"
        echo -e "  macOS: ${YELLOW}brew services start redis${NC}"
        echo -e "  Linux: ${YELLOW}sudo systemctl start redis${NC}"
        exit 1
    fi
    echo -e "Redis: ${GREEN}Started${NC}"
fi

# Setup database
echo -e "\n${YELLOW}Setting up database...${NC}"

# Read DB credentials from .env if exists
if [ -f "$SCRIPT_DIR/.env" ]; then
    export $(grep -E '^DB_' "$SCRIPT_DIR/.env" | xargs)
fi

DB_USER=${DB_USERNAME:-root}
DB_PASS=${DB_PASSWORD:-}
DB_HOST=${DB_HOST:-localhost}
DB_PORT=${DB_PORT:-3306}

# Build MySQL command
MYSQL_CMD="mysql -h$DB_HOST -P$DB_PORT -u$DB_USER"
if [ -n "$DB_PASS" ]; then
    MYSQL_CMD="$MYSQL_CMD -p$DB_PASS"
fi

# Check if database exists
DB_EXISTS=$($MYSQL_CMD -e "SHOW DATABASES LIKE '$DB_NAME';" 2>/dev/null | grep -c "$DB_NAME" || true)

if [ "$DB_EXISTS" -eq 0 ]; then
    echo -e "Database '$DB_NAME' not found. Creating..."
    $MYSQL_CMD -e "CREATE DATABASE IF NOT EXISTS $DB_NAME;" 2>/dev/null
fi

# Check if game_config_coinflip table exists
TABLE_EXISTS=$($MYSQL_CMD -e "USE $DB_NAME; SHOW TABLES LIKE 'game_config_coinflip';" 2>/dev/null | grep -c "game_config_coinflip" || true)

if [ "$TABLE_EXISTS" -eq 0 ]; then
    echo -e "CoinFlip config not found. Loading database dump..."
    if [ -f "$DUMP_FILE" ]; then
        $MYSQL_CMD < "$DUMP_FILE" 2>/dev/null
        echo -e "Database: ${GREEN}Loaded from dump${NC}"
    else
        echo -e "${RED}Error: Dump file not found at $DUMP_FILE${NC}"
        exit 1
    fi
else
    echo -e "Database: ${GREEN}Already configured${NC}"
fi

if [ "$SETUP_ONLY" = true ]; then
    echo -e "\n${GREEN}Setup complete!${NC}"
    exit 0
fi

# Install dependencies if needed
echo -e "\n${YELLOW}Checking dependencies...${NC}"
cd "$SCRIPT_DIR"

if [ ! -d "node_modules" ] || [ "package.json" -nt "node_modules" ]; then
    echo "Installing backend dependencies..."
    npm install --legacy-peer-deps
fi
echo -e "Dependencies: ${GREEN}OK${NC}"

# Build backend
echo -e "\n${YELLOW}Building backend...${NC}"
npm run build
echo -e "Build: ${GREEN}Complete${NC}"

# Function to cleanup on exit
cleanup() {
    echo -e "\n${YELLOW}Shutting down...${NC}"

    # Kill backend if running
    if [ -n "$BACKEND_PID" ]; then
        kill $BACKEND_PID 2>/dev/null || true
    fi

    # Kill frontend if running
    if [ -n "$FRONTEND_PID" ]; then
        kill $FRONTEND_PID 2>/dev/null || true
    fi

    # Kill any node processes started by this script
    pkill -f "node dist/main.js" 2>/dev/null || true
    pkill -f "npx serve.*coinflip" 2>/dev/null || true

    echo -e "${GREEN}Shutdown complete${NC}"
    exit 0
}

trap cleanup INT TERM

# Start backend
if [ "$START_BACKEND" = true ]; then
    echo -e "\n${YELLOW}Starting backend on port $BACKEND_PORT...${NC}"

    # Kill any existing process on the port
    lsof -ti:$BACKEND_PORT | xargs kill -9 2>/dev/null || true

    npm run start:prod &
    BACKEND_PID=$!

    # Wait for backend to be ready
    wait_for_service localhost $BACKEND_PORT "backend" || exit 1
    echo -e "Backend: ${GREEN}Running at http://localhost:$BACKEND_PORT${NC}"
    echo -e "API Docs: ${BLUE}http://localhost:$BACKEND_PORT/api${NC}"
fi

# Start frontend
if [ "$START_FRONTEND" = true ]; then
    echo -e "\n${YELLOW}Starting frontend on port $FRONTEND_PORT...${NC}"

    # Kill any existing process on the port
    lsof -ti:$FRONTEND_PORT | xargs kill -9 2>/dev/null || true

    # Check if serve is installed
    if ! command_exists serve; then
        echo "Installing serve globally..."
        npm install -g serve
    fi

    cd "$SCRIPT_DIR/coinflip-clone-httrack"
    npx serve -l $FRONTEND_PORT -s &
    FRONTEND_PID=$!

    sleep 2
    echo -e "Frontend: ${GREEN}Running at http://localhost:$FRONTEND_PORT${NC}"
fi

# Print summary
echo -e "\n${GREEN}========================================${NC}"
echo -e "${GREEN}   CoinFlip Game is Ready!${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
if [ "$START_FRONTEND" = true ]; then
    echo -e "${BLUE}Open in browser:${NC}"
    echo -e "  ${GREEN}http://localhost:$FRONTEND_PORT?userId=$COINFLIP_USER_ID${NC}"
    echo ""
    echo -e "${BLUE}User ID:${NC} $COINFLIP_USER_ID"
    echo ""
fi
if [ "$START_BACKEND" = true ]; then
    echo -e "${BLUE}Backend API:${NC}"
    echo -e "  ${GREEN}http://localhost:$BACKEND_PORT${NC}"
    echo -e "  ${GREEN}http://localhost:$BACKEND_PORT/api${NC} (Swagger)"
    echo ""
fi
echo -e "${YELLOW}Press Ctrl+C to stop all services${NC}"
echo ""

# Keep script running
wait
