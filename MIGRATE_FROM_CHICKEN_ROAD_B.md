# Migration Guide: chicken-road-b → vector-games-v2

## Overview
This guide helps you migrate from `chicken-road-b` to `vector-games-v2` on your DigitalOcean droplet while maintaining the same domain (`api.demolink.games`).

## Pre-Migration Checklist

- [ ] Backup database
- [ ] Note current environment variables
- [ ] Verify domain DNS points to server
- [ ] Ensure SSL certificate exists for `api.demolink.games`

## Step 1: Backup Current Setup

```bash
# SSH into server
ssh root@your-server-ip

# Backup database
cd /opt/chicken-road-b
docker exec chicken-road-mysql mysqldump -u root -p chickenroad > /tmp/chickenroad-backup-$(date +%Y%m%d).sql

# Backup environment file
cp .env.production /tmp/chicken-road-b-env-backup.txt

# Note current container status
docker ps > /tmp/chicken-road-b-containers.txt
```

## Step 2: Stop Old Application

```bash
cd /opt/chicken-road-b

# Stop containers
docker compose -f docker-compose.prod.yml --env-file .env.production down

# Verify containers are stopped
docker ps | grep chicken-road
```

## Step 3: Setup New Application

```bash
# Create new directory structure
mkdir -p /opt/vector-games
cd /opt/vector-games

# Clone vector-games-v2
git clone https://github.com/games-vector/vector-games-v2.git

# Clone game-platform-core (if in separate repo)
# git clone https://github.com/games-vector/game-platform-core.git ../game-platform-core
# Or ensure it's already in parent directory
```

## Step 4: Configure Environment

```bash
cd /opt/vector-games/vector-games-v2

# Copy template
cp env.production.template .env.production

# Edit environment file
nano .env.production
```

**Key values to set:**
```env
# Database - can reuse same database or create new
DB_DATABASE=chickenroad  # or vectorgames
DB_USERNAME=chickenroad_user  # or create new user
DB_PASSWORD=<your-existing-password>
DB_ROOT_PASSWORD=<your-existing-root-password>

# Redis - same as before
REDIS_HOST=redis
REDIS_PORT=6379

# JWT - use existing or generate new
JWT_SECRET=<your-existing-secret>

# Frontend Host
FRONTEND_HOST=api.demolink.games
```

## Step 5: Setup Nginx with SSL

**Option A: If SSL certificate already exists (from chicken-road-b):**

```bash
cd /opt/vector-games/vector-games-v2

# Copy nginx config
sudo cp nginx/nginx.conf /etc/nginx/sites-available/vector-games-v2

# Verify SSL certificate paths in the config
sudo nano /etc/nginx/sites-available/vector-games-v2
# Ensure these paths are correct:
# ssl_certificate /etc/letsencrypt/live/api.demolink.games/fullchain.pem;
# ssl_certificate_key /etc/letsencrypt/live/api.demolink.games/privkey.pem;

# Enable the site
sudo ln -sf /etc/nginx/sites-available/vector-games-v2 /etc/nginx/sites-enabled/

# Remove old chicken-road-b config
sudo rm -f /etc/nginx/sites-enabled/chicken-road-backend

# Test and reload nginx
sudo nginx -t
sudo systemctl reload nginx
```

**Option B: Setup SSL certificate (if not exists):**

```bash
cd /opt/vector-games/vector-games-v2

# Make script executable
chmod +x setup-letsencrypt.sh

# Run SSL setup
sudo ./setup-letsencrypt.sh api.demolink.games
```

## Step 6: Deploy Application

```bash
cd /opt/vector-games/vector-games-v2

# Make deploy script executable
chmod +x deploy.sh

# Run deployment
./deploy.sh
```

## Step 7: Database Migration

If reusing the same database:

```bash
# Connect to MySQL
docker exec -it vector-games-mysql mysql -u root -p

# Use your database
USE chickenroad;  # or vectorgames

# Add game entries (if not auto-created by modules)
INSERT INTO games (gameCode, gameName, platform, gameType, settleType, isActive)
VALUES 
  ('chicken-road-two', 'chicken-road-2', 'In-out', 'CRASH', 'platformTxId', true),
  ('chicken-road-vegas', 'chicken-road-vegas', 'In-out', 'CRASH', 'platformTxId', true),
  ('sugar-daddy', 'Sugar Daddy', 'In-out', 'CRASH', 'platformTxId', true)
ON DUPLICATE KEY UPDATE isActive = true;
```

## Step 8: Verify Deployment

```bash
# Check containers
docker ps

# Check application health
curl https://api.demolink.games/health

# Check WebSocket endpoint
curl https://api.demolink.games/io/

# View logs
docker compose -f docker-compose.prod.yml --env-file .env.production logs -f app
```

## Step 9: Cleanup Old Application (Optional)

**⚠️ Only after confirming new application works:**

```bash
# Remove old directory
cd /opt
rm -rf chicken-road-b

# Remove old nginx config (already done in step 5)
# sudo rm -f /etc/nginx/sites-available/chicken-road-backend
```

## Rollback Plan

If something goes wrong:

```bash
# Stop new application
cd /opt/vector-games/vector-games-v2
docker compose -f docker-compose.prod.yml --env-file .env.production down

# Restore old nginx config
sudo ln -sf /etc/nginx/sites-available/chicken-road-backend /etc/nginx/sites-enabled/vector-games-v2
sudo rm -f /etc/nginx/sites-enabled/vector-games-v2
sudo systemctl reload nginx

# Restart old application
cd /opt/chicken-road-b
docker compose -f docker-compose.prod.yml --env-file .env.production up -d
```

## Differences from chicken-road-b

1. **Container names**: `vector-games-*` instead of `chicken-road-*`
2. **Database name**: Can use `vectorgames` or keep `chickenroad`
3. **Multi-game support**: Handles multiple games (chicken-road-two, chicken-road-vegas, sugar-daddy)
4. **Package dependency**: Uses `game-platform-core` npm package

## Post-Migration Tasks

- [ ] Test all game endpoints
- [ ] Verify WebSocket connections work
- [ ] Check database migrations completed
- [ ] Update frontend API URLs if needed
- [ ] Monitor logs for errors
- [ ] Verify SSL certificate auto-renewal
