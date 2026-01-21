# Vector Games V2 Deployment Steps

## Prerequisites
- DigitalOcean droplet with Docker, Docker Compose, and Nginx installed
- Domain `api.demolink.games` pointing to your server IP
- SSH access to the server

## Step-by-Step Deployment

### 1. Stop and Remove Old Application

```bash
# SSH into your server
ssh root@your-server-ip

# Navigate to old application
cd /opt/chicken-road-b

# Stop and remove old containers
docker compose -f docker-compose.prod.yml --env-file .env.production down

# Remove old directory (optional - backup first if needed)
cd /opt
rm -rf chicken-road-b
```

### 2. Clone and Setup New Application

```bash
# Create deployment directory
mkdir -p /opt/vector-games
cd /opt/vector-games

# Clone both repositories
git clone https://github.com/games-vector/vector-games-v2.git
git clone https://github.com/games-vector/game-platform-core.git

# Verify directory structure
ls -la
# Should show:
# - game-platform-core/
# - vector-games-v2/
```

**Important:** Both repositories must be in the same parent directory (`/opt/vector-games/`) for the deployment to work.

### 3. Configure Environment

```bash
cd /opt/vector-games/vector-games-v2

# Copy environment template
cp env.production.template .env.production

# Edit environment file
nano .env.production
```

**Update these values in `.env.production`:**
```env
# Database Configuration
DB_HOST=mysql
DB_PORT=3306
DB_USERNAME=vectorgames_user
DB_PASSWORD=your_secure_password
DB_DATABASE=vectorgames  # or keep 'chickenroad' if reusing database
DB_ROOT_PASSWORD=your_secure_root_password
DB_SYNCHRONIZE=false

# Redis Configuration
REDIS_HOST=redis
REDIS_PORT=6379
REDIS_PASSWORD=

# JWT Configuration
JWT_SECRET=your_very_long_and_secure_secret_key_min_32_chars

# Frontend Host
FRONTEND_HOST=api.demolink.games

# Logging
LOG_LEVEL=info
```

### 4. Setup Nginx with SSL

```bash
cd /opt/vector-games/vector-games-v2

# Make SSL setup script executable
chmod +x setup-letsencrypt.sh

# Run SSL setup (will configure for api.demolink.games)
sudo ./setup-letsencrypt.sh api.demolink.games
```

**Alternative: If SSL certificate already exists from chicken-road-b:**

```bash
# Copy nginx config
sudo cp nginx/nginx.conf /etc/nginx/sites-available/vector-games-v2

# Update the config to use existing certificate path
sudo nano /etc/nginx/sites-available/vector-games-v2
# Verify SSL certificate paths point to:
# /etc/letsencrypt/live/api.demolink.games/fullchain.pem
# /etc/letsencrypt/live/api.demolink.games/privkey.pem

# Enable the site
sudo ln -sf /etc/nginx/sites-available/vector-games-v2 /etc/nginx/sites-enabled/

# Remove old chicken-road-b config (if exists)
sudo rm -f /etc/nginx/sites-enabled/chicken-road-backend

# Test and reload nginx
sudo nginx -t
sudo systemctl reload nginx
```

### 5. Deploy Application

```bash
cd /opt/vector-games/vector-games-v2

# Make deploy script executable
chmod +x deploy.sh

# Run deployment
./deploy.sh
```

The script will:
- Build game-platform-core package
- Build and start Docker containers
- Wait for services to be healthy
- Verify deployment

### 6. Verify Deployment

```bash
# Check containers are running
docker ps

# Check application logs
docker compose -f docker-compose.prod.yml --env-file .env.production logs -f app

# Test health endpoint
curl http://localhost:3000/health

# Test via domain (should work with HTTPS)
curl https://api.demolink.games/health
```

### 7. Database Migration (if reusing chicken-road-b database)

If you're reusing the same database:

```bash
# Connect to MySQL
docker exec -it vector-games-mysql mysql -u root -p

# Use your database
USE chickenroad;  # or vectorgames

# Add game entries if not auto-created
INSERT INTO games (gameCode, gameName, platform, gameType, settleType, isActive)
VALUES 
  ('chicken-road-two', 'chicken-road-2', 'In-out', 'CRASH', 'platformTxId', true),
  ('chicken-road-vegas', 'chicken-road-vegas', 'In-out', 'CRASH', 'platformTxId', true),
  ('sugar-daddy', 'Sugar Daddy', 'In-out', 'CRASH', 'platformTxId', true)
ON DUPLICATE KEY UPDATE isActive = true;
```

## Troubleshooting

### Container won't start
```bash
docker compose -f docker-compose.prod.yml --env-file .env.production logs app
```

### Nginx 502 Bad Gateway
- Check if app container is running: `docker ps | grep vector-games-backend`
- Check app logs: `docker logs vector-games-backend`
- Verify port 3000 is accessible: `curl http://localhost:3000/health`

### SSL Certificate Issues
```bash
# Check certificate
sudo certbot certificates

# Renew certificate
sudo certbot renew

# Test nginx config
sudo nginx -t
```

### Database Connection Issues
```bash
# Check MySQL container
docker logs vector-games-mysql

# Test connection
docker exec -it vector-games-mysql mysql -u vectorgames_user -p vectorgames
```

### game-platform-core not found
```bash
# Verify it's in the parent directory
ls -la /opt/vector-games/
# Should show:
# - game-platform-core/
# - vector-games-v2/

# If missing, clone it:
cd /opt/vector-games
git clone https://github.com/games-vector/game-platform-core.git
```

## Maintenance

### Update Application
```bash
cd /opt/vector-games/vector-games-v2
git pull origin main
./deploy.sh
```

### Update game-platform-core
```bash
cd /opt/vector-games/game-platform-core
git pull origin main
# Then redeploy vector-games-v2
cd ../vector-games-v2
./deploy.sh
```

### View Logs
```bash
# Application logs
docker compose -f docker-compose.prod.yml --env-file .env.production logs -f app

# All services
docker compose -f docker-compose.prod.yml --env-file .env.production logs -f
```

### Stop Services
```bash
docker compose -f docker-compose.prod.yml --env-file .env.production down
```

### Restart Services
```bash
docker compose -f docker-compose.prod.yml --env-file .env.production restart
```
