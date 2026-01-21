# Vector Games V2 Deployment Guide

## Overview

This guide explains how to deploy Vector Games V2 to a DigitalOcean droplet (or any Linux server) using Docker and Docker Compose.

## Prerequisites

- DigitalOcean droplet (or any Linux server) with:
  - Docker installed
  - Docker Compose installed
  - Git installed
  - Nginx installed (for reverse proxy)
- Access to the server via SSH
- GitHub repository: https://github.com/vector-games/vector-games-v2.git

## Repository Structure

```
/root (or your deployment directory)
├── game-platform-core/          # Core package (must be in parent directory)
└── vector-games-v2/             # Main application
    ├── deploy.sh
    ├── Dockerfile
    ├── docker-compose.prod.yml
    ├── .env.production
    └── ...
```

## Initial Setup

### 1. Prepare the Server

```bash
# SSH into your DigitalOcean droplet
ssh root@your-server-ip

# Create deployment directory
mkdir -p /opt/vector-games
cd /opt/vector-games

# Clone the repositories
git clone https://github.com/vector-games/vector-games-v2.git
# If game-platform-core is in a separate repo:
# git clone https://github.com/vector-games/game-platform-core.git
# Or if it's in the same repo, ensure it's in the parent directory
```

### 2. Configure Environment Variables

```bash
cd vector-games-v2

# Copy the template
cp env.production.template .env.production

# Edit the environment file
nano .env.production
```

Update the following values in `.env.production`:

```env
# Database Configuration
DB_USERNAME=vectorgames_user
DB_PASSWORD=your_secure_password
DB_DATABASE=vectorgames
DB_ROOT_PASSWORD=your_secure_root_password

# JWT Configuration
JWT_SECRET=your_very_long_and_secure_secret_key_min_32_chars

# Frontend Host
FRONTEND_HOST=your-server-ip-or-domain
```

### 3. Setup Nginx

```bash
# Copy nginx configuration
sudo cp nginx/nginx.conf /etc/nginx/sites-available/vector-games-v2

# Create symlink
sudo ln -s /etc/nginx/sites-available/vector-games-v2 /etc/nginx/sites-enabled/

# Remove default site (if exists)
sudo rm -f /etc/nginx/sites-enabled/default

# Test nginx configuration
sudo nginx -t

# Reload nginx
sudo systemctl reload nginx
```

### 4. Make deploy.sh Executable

```bash
chmod +x deploy.sh
```

## Deployment Process

### First Time Deployment

```bash
cd /opt/vector-games/vector-games-v2

# Run the deployment script
./deploy.sh
```

The script will:
1. ✅ Check prerequisites (Docker, Docker Compose, .env.production)
2. ✅ Verify game-platform-core exists
3. 📦 Build game-platform-core package
4. 🛑 Stop existing containers
5. 🔨 Build and start Docker containers
6. ⏳ Wait for services to be healthy
7. ✅ Verify deployment

### Subsequent Deployments

```bash
# Pull latest code
cd /opt/vector-games/vector-games-v2
git pull origin main  # or your branch name

# Run deployment
./deploy.sh
```

## Directory Structure on Server

```
/opt/vector-games/
├── game-platform-core/          # Core package source
│   ├── package.json
│   ├── src/
│   └── ...
└── vector-games-v2/             # Main application
    ├── deploy.sh
    ├── Dockerfile
    ├── docker-compose.prod.yml
    ├── .env.production
    ├── logs/                    # Application logs
    └── ...
```

## How game-platform-core Package Works

1. **Local Development**: The package is referenced as:
   ```json
   "@vector-games/game-core": "file:../game-platform-core/vector-games-game-core-1.0.0.tgz"
   ```

2. **Deployment Process**:
   - `deploy.sh` builds the package in `game-platform-core/`
   - Creates a `.tgz` file: `vector-games-game-core-1.0.0.tgz`
   - Copies it to `vector-games-v2/` directory
   - Dockerfile uses this `.tgz` file during build
   - Package is installed in the Docker container

3. **Package Location**: The package must be in the **parent directory** of `vector-games-v2`:
   ```
   /opt/vector-games/
   ├── game-platform-core/     ← Must be here
   └── vector-games-v2/
   ```

## Container Management

### View Logs

```bash
cd /opt/vector-games/vector-games-v2
docker compose -f docker-compose.prod.yml --env-file .env.production logs -f app
```

### Stop Services

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production down
```

### Restart Services

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production restart
```

### Check Status

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production ps
```

## Database Setup

The deployment script automatically creates the database if it doesn't exist. However, you may need to:

1. **Create initial game entries** (if not auto-created):
   ```sql
   INSERT INTO games (gameCode, gameName, platform, gameType, settleType, isActive)
   VALUES 
     ('chicken-road-two', 'chicken-road-2', 'In-out', 'CRASH', 'platformTxId', true),
     ('chicken-road-vegas', 'chicken-road-vegas', 'In-out', 'CRASH', 'platformTxId', true),
     ('sugar-daddy', 'Sugar Daddy', 'In-out', 'CRASH', 'platformTxId', true);
   ```

2. **Migrate data from chicken-road-b** (if applicable):
   - Export data from old database
   - Import to new database
   - Update game codes if needed

## Troubleshooting

### Container Won't Start

```bash
# Check logs
docker compose -f docker-compose.prod.yml --env-file .env.production logs app

# Check container status
docker ps -a | grep vector-games
```

### Package Build Fails

```bash
# Manually build the package
cd /opt/vector-games/game-platform-core
npm ci
npm run build
npm pack

# Verify the .tgz file exists
ls -la vector-games-game-core-*.tgz
```

### Database Connection Issues

```bash
# Check MySQL container
docker logs vector-games-mysql

# Test connection
docker exec -it vector-games-mysql mysql -u vectorgames_user -p vectorgames
```

### Redis Connection Issues

```bash
# Check Redis container
docker logs vector-games-redis

# Test connection
docker exec -it vector-games-redis redis-cli ping
```

## Updating from chicken-road-b

If you're replacing an existing chicken-road-b deployment:

1. **Stop old services**:
   ```bash
   cd /path/to/chicken-road-b
   docker compose -f docker-compose.prod.yml --env-file .env.production down
   ```

2. **Backup database** (if needed):
   ```bash
   docker exec vector-games-mysql mysqldump -u root -p vectorgames > backup.sql
   ```

3. **Deploy vector-games-v2** (follow steps above)

4. **Migrate data** (if needed):
   - Update game codes in database
   - Migrate game_config table entries
   - Update any hardcoded references

## Security Considerations

1. **Change default passwords** in `.env.production`
2. **Use strong JWT secret** (minimum 32 characters)
3. **Keep Docker updated**: `apt update && apt upgrade docker.io`
4. **Firewall rules**: Only expose necessary ports (80, 443)
5. **Regular backups**: Database and Redis data

## Monitoring

- **Health endpoint**: `http://your-server/health`
- **Container health**: `docker ps` (check STATUS column)
- **Application logs**: `./logs/app-*.log`
- **Error logs**: `./logs/error-*.log`

## Support

For issues or questions:
- Check logs: `./logs/` directory
- Check container logs: `docker compose logs`
- Review deployment script output for errors
