# Vector Games V2 - Setup Guide

This guide will help you set up the Vector Games V2 backend repository from scratch.

## ⚠️ Important: Core Package Dependency

**Before you begin:** This project depends on `@games-vector/game-core` which is published to **GitHub Packages**. 

### Option A: Install from GitHub Packages (Most Users)
**You will need:**
1. ✅ Access to the `games-vector` GitHub organization
2. ✅ **A GitHub Personal Access Token (PAT) with `read:packages` permission** - **REQUIRED**
3. ✅ Configure `.npmrc` file with your token

**Quick Setup:**
```bash
# 1. Get your GitHub token from: https://github.com/settings/tokens
#    (Select 'read:packages' scope)

# 2. Create .npmrc in vector-games-v2/
echo "@games-vector:registry=https://npm.pkg.github.com" > .npmrc
echo "//npm.pkg.github.com/:_authToken=YOUR_GITHUB_TOKEN_HERE" >> .npmrc

# 3. Install dependencies
npm install --legacy-peer-deps
```

### Option B: Use Local Package (Developers)
**If you have `game-platform-core` source code:**
- ✅ **NO TOKEN NEEDED**
- See [Option 2](#getting-access-to-the-package) below

See [GitHub Packages Access](#github-packages-access) section for detailed instructions.

---

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Environment Setup](#environment-setup)
3. [Database Setup](#database-setup)
4. [Dependencies Installation](#dependencies-installation)
5. [Configuration](#configuration)
6. [Database Initialization](#database-initialization)
7. [Running the Application](#running-the-application)
8. [Docker Setup (Optional)](#docker-setup-optional)
9. [Verification](#verification)
10. [Troubleshooting](#troubleshooting)

---

## Prerequisites

Before setting up the repository, ensure you have the following installed:

### Required Software

- **Node.js**: Version 20.x or higher
  - Download from [nodejs.org](https://nodejs.org/)
  - Verify installation: `node --version`

- **npm**: Version 9.x or higher (comes with Node.js)
  - Verify installation: `npm --version`

- **MySQL**: Version 8.0 or higher
  - Download from [mysql.com](https://dev.mysql.com/downloads/mysql/)
  - Verify installation: `mysql --version`

- **Redis**: Version 7.x or higher
  - Download from [redis.io](https://redis.io/download)
  - Verify installation: `redis-cli --version`

### Optional Software

- **Docker & Docker Compose**: For containerized deployment
  - Download from [docker.com](https://www.docker.com/get-started)
  - Verify installation: `docker --version` and `docker-compose --version`

- **Git**: For cloning the repository
  - Download from [git-scm.com](https://git-scm.com/downloads)
  - Verify installation: `git --version`

### GitHub Packages Access

The project uses `@games-vector/game-core` package from **GitHub Packages**. This package is already published and available, but you need proper authentication to install it.

#### What is `@games-vector/game-core`?

This is a core game platform package that provides:
- Bet management services
- Wallet API integration
- User and agent management
- JWT token services
- Authentication guards

**Package Location:** https://github.com/games-vector/game-platform-core/packages

#### Getting Access to the Package

You have two options:

| Feature | Option 1: GitHub Packages | Option 2: Local Package |
|---------|---------------------------|-------------------------|
| **GitHub Token Required?** | ✅ **YES - REQUIRED** | ❌ No |
| **GitHub Access Required?** | ✅ Yes (organization access) | ❌ No |
| **Best For** | Most users, production | Developers, contributors |
| **Setup Complexity** | Medium (need token) | Easy (if you have source) |
| **Package Updates** | Automatic (from registry) | Manual (rebuild needed) |

**Option 1: Install from GitHub Packages (Recommended for most users)**

**⚠️ YES, THIS REQUIRES A GITHUB PERSONAL ACCESS TOKEN (PAT)**

GitHub Packages requires authentication to download packages. You **must** have a GitHub Personal Access Token to install `@games-vector/game-core`.

**Requirements:**

1. **GitHub Account Access**
   - You need access to the `games-vector` GitHub organization
   - Contact your team administrator to grant you access to the repository
   - Verify access: https://github.com/orgs/games-vector/packages

2. **GitHub Personal Access Token (PAT) - REQUIRED** ✅
   
   **Step-by-step token creation:**
   
   a. Go to: https://github.com/settings/tokens
   
   b. Click "Generate new token" → "Generate new token (classic)"
   
   c. Give it a descriptive name (e.g., "Vector Games npm access")
   
   d. Set expiration (recommended: 90 days or custom)
   
   e. **Select required scopes:**
      - ✅ **`read:packages`** (MANDATORY - allows downloading packages)
      - ✅ **`repo`** (if the repository is private)
   
   f. Click "Generate token" at the bottom
   
   g. **⚠️ IMPORTANT: Copy the token immediately!** 
      - You'll see it only once
      - It looks like: `ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`
      - Save it securely (password manager recommended)
   
   h. If you lose the token, you'll need to generate a new one

3. **Configure npm Authentication**
   - You'll use this token in the `.npmrc` file (see next section)
   - The token authenticates npm to download from GitHub Packages

**Option 2: Use Local Package (For Development/Contributors) - NO TOKEN NEEDED** ✅

**Use this option if:**
- You have the `game-platform-core` source code locally
- You're developing or modifying the core package
- You want to avoid GitHub Packages authentication

**Steps:**

1. Navigate to the `game-platform-core` directory:
   ```bash
   cd ../game-platform-core
   ```

2. Build the package:
   ```bash
   npm run build
   ```

3. Update `vector-games-v2/package.json`:
   ```json
   {
     "dependencies": {
       "@games-vector/game-core": "file:../game-platform-core"
     }
   }
   ```

4. Install dependencies:
   ```bash
   cd ../vector-games-v2
   npm install
   ```

**Note:** 
- ✅ No GitHub token required for this option
- ✅ Changes to `game-platform-core` are immediately available
- ⚠️ Requires the `game-platform-core` directory to be in the parent folder

---

## Environment Setup

### 1. Clone the Repository

```bash
git clone <repository-url>
cd vector-games-v2
```

### 2. Configure npm for GitHub Packages

**This step is required to install `@games-vector/game-core` from GitHub Packages.**

Create or edit `.npmrc` file in the `vector-games-v2` project root:

**On Linux/Mac:**
```bash
cat > .npmrc << EOF
@games-vector:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=YOUR_GITHUB_TOKEN_HERE
EOF
```

**On Windows (PowerShell):**
```powershell
@"
@games-vector:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=YOUR_GITHUB_TOKEN_HERE
"@ | Out-File -FilePath .npmrc -Encoding utf8
```

**Or manually create `.npmrc` file with this content:**
```
@games-vector:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=YOUR_GITHUB_TOKEN_HERE
```

**Important:**
- Replace `YOUR_GITHUB_TOKEN_HERE` with your actual GitHub Personal Access Token
- The token must have `read:packages` permission
- **Security:** Add `.npmrc` to `.gitignore` to avoid committing your token

**Verify `.npmrc` is in `.gitignore`:**
```bash
# Check if .npmrc is ignored
cat .gitignore | grep npmrc

# If not, add it:
echo ".npmrc" >> .gitignore
```

**Alternative: Use npm login (interactive)**

Instead of creating `.npmrc`, you can use npm login:

```bash
npm login --registry=https://npm.pkg.github.com --scope=@games-vector
```

When prompted:
- **Username:** Your GitHub username
- **Password:** Your GitHub Personal Access Token (not your GitHub password!)
- **Email:** Your GitHub email address

---

## Database Setup

### 1. Create MySQL Database

Connect to MySQL and create the database:

```bash
mysql -u root -p
```

```sql
CREATE DATABASE vectorgames CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'vectorgames_user'@'localhost' IDENTIFIED BY 'your_secure_password';
GRANT ALL PRIVILEGES ON vectorgames.* TO 'vectorgames_user'@'localhost';
FLUSH PRIVILEGES;
EXIT;
```

**Note:** Replace `your_secure_password` with a strong password.

### 2. Verify Redis is Running

Start Redis server:

```bash
# On Linux/Mac
redis-server

# On Windows (if installed as service, it should start automatically)
# Or run: redis-server
```

Verify Redis is accessible:

```bash
redis-cli ping
# Should return: PONG
```

---

## Dependencies Installation

### 1. Install Node.js Dependencies

Install all dependencies including `@games-vector/game-core`:

```bash
npm install --legacy-peer-deps
```

**What happens:**
- npm will read your `.npmrc` file
- Authenticate with GitHub Packages using your token
- Download `@games-vector/game-core` from GitHub Packages
- Install all other dependencies from npm registry

**Note:** The `--legacy-peer-deps` flag is required due to peer dependency conflicts.

**If you get authentication errors:**
- Verify your GitHub token is correct in `.npmrc`
- Check token has `read:packages` permission
- Ensure you have access to the `games-vector` organization
- Try regenerating your token

### 2. Verify Installation

Check that `@games-vector/game-core` is installed:

```bash
# Check if the package is installed
npm list @games-vector/game-core

# Should show something like:
# └── @games-vector/game-core@1.0.0

# Check all dependencies
npm list --depth=0
```

**Verify package location:**
```bash
# Check where the package is installed from
npm list @games-vector/game-core --long

# Should show it's from GitHub Packages registry
```

---

## Configuration

### 1. Create Environment File

Copy the template and create your environment file:

```bash
cp env.production.template .env
```

### 2. Configure Environment Variables

Edit `.env` file with your configuration:

```env
# Application Configuration
APP_PORT=3000
APP_ENV=development
NODE_ENV=development

# Database Configuration
DB_HOST=localhost
DB_PORT=3306
DB_USERNAME=vectorgames_user
DB_PASSWORD=your_secure_password
DB_DATABASE=vectorgames
DB_ROOT_PASSWORD=your_mysql_root_password
DB_SYNCHRONIZE=true

# Redis Configuration
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=

# JWT Configuration
JWT_SECRET=your_jwt_secret_key_minimum_32_characters_long
JWT_EXPIRES_IN=7d

# Frontend Host (for login URLs)
FRONTEND_HOST=http://localhost:5173

# Logging
LOG_LEVEL=debug

# Wallet Mock (set to true to use mock wallet service instead of real API)
# MOCK_WALLET=false
```

**Important Configuration Notes:**

- **DB_SYNCHRONIZE**: 
  - Set to `true` for development (auto-creates tables)
  - Set to `false` for production (use migrations)
  
- **JWT_SECRET**: 
  - Must be at least 32 characters long
  - Use a strong, random string in production
  
- **DB_PASSWORD**: 
  - Use the password you created for the `vectorgames_user` MySQL user

### 3. Environment-Specific Files

You can create different environment files:
- `.env.development` - For development
- `.env.production` - For production
- `.env.test` - For testing

The application will automatically load the appropriate file based on `NODE_ENV`.

---

## Database Initialization

### 1. Run Database Migrations (if using TypeORM migrations)

If you have migrations, run them:

```bash
npm run migration:run
```

**Note:** If `DB_SYNCHRONIZE=true`, TypeORM will automatically create tables on first run.

### 2. Initialize Game Configurations

After the database is set up, run the SQL scripts to initialize game configurations:

#### Sugar Daddy Game Configuration

```bash
mysql -u vectorgames_user -p vectorgames < coefficient-distribution-setup.sql
```

#### Diver Game Configuration

```bash
mysql -u vectorgames_user -p vectorgames < diver-game-setup.sql
```

**Note:** These scripts set up:
- RTP (Return to Player) percentages
- Coefficient speed settings
- Coefficient distribution ranges
- Game-specific configurations

### 3. Verify Database Tables

Connect to MySQL and verify tables are created:

```bash
mysql -u vectorgames_user -p vectorgames
```

```sql
SHOW TABLES;
-- Should show tables like: games, bets, users, agents, etc.
```

---

## Running the Application

### Development Mode

Start the application in development mode with hot-reload:

```bash
npm run start:dev
```

The application will:
- Watch for file changes
- Automatically restart on changes
- Run on port 3000 (or your configured `APP_PORT`)

### Production Mode

1. Build the application:

```bash
npm run build
```

2. Start the application:

```bash
npm run start:prod
```

### Debug Mode

Start with debugging enabled:

```bash
npm run start:debug
```

Then attach your debugger to port 9229 (default Node.js debug port).

### Verify Application is Running

1. **Health Check:**
   ```bash
   curl http://localhost:3000/health
   ```

2. **API Documentation:**
   Open in browser: `http://localhost:3000/api`
   - Swagger UI will be available at this endpoint

3. **Check Logs:**
   - Console output for development
   - `logs/` directory for file logs in production

---

## Docker Setup (Optional)

### Prerequisites

- Docker and Docker Compose installed
- GitHub token for accessing `@games-vector/game-core` package

### 1. Configure Environment for Docker

Create `.env.production` file:

```bash
cp env.production.template .env.production
```

Edit `.env.production` with your production values.

### 2. Set GitHub Token

Export your GitHub token (for Docker build):

```bash
export GITHUB_TOKEN=your_github_token_here
```

### 3. Start Services with Docker Compose

```bash
docker-compose -f docker-compose.prod.yml up -d
```

This will start:
- MySQL container
- Redis container
- Application container

### 4. View Logs

```bash
# All services
docker-compose -f docker-compose.prod.yml logs -f

# Specific service
docker-compose -f docker-compose.prod.yml logs -f app
```

### 5. Stop Services

```bash
docker-compose -f docker-compose.prod.yml down
```

### 6. Rebuild After Changes

```bash
docker-compose -f docker-compose.prod.yml up -d --build
```

---

## Verification

### 1. Check Application Health

```bash
curl http://localhost:3000/health
```

Expected response:
```json
{
  "status": "ok",
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

### 2. Access Swagger Documentation

Open in browser: `http://localhost:3000/api`

You should see the Swagger UI with API documentation.

### 3. Test WebSocket Connection

The WebSocket endpoint is available at:
```
ws://localhost:3000/io?gameMode=sugar-daddy&operatorId=xxx&Authorization=xxx
```

**Note:** You'll need a valid JWT token for authentication.

### 4. Check Database Connection

Verify the application can connect to MySQL by checking logs for:
```
Application is running on: 3000 env=development auth=ENABLED dbHost=localhost
```

### 5. Check Redis Connection

The application should connect to Redis automatically. Check logs for any Redis connection errors.

---

## Troubleshooting

### Common Issues

#### 1. GitHub Packages Authentication Error

**Error:** `npm ERR! 401 Unauthorized` when installing `@games-vector/game-core`

**Possible Causes & Solutions:**

1. **Invalid or Missing Token:**
   - Verify your GitHub token is correct in `.npmrc`
   - Check there are no extra spaces or quotes around the token
   - Regenerate token if needed

2. **Token Permissions:**
   - Ensure token has `read:packages` permission
   - Go to GitHub Settings → Tokens and verify permissions

3. **Expired Token:**
   - GitHub tokens can expire
   - Generate a new token and update `.npmrc`

4. **No Access to Organization:**
   - Verify you have access to `games-vector` GitHub organization
   - Contact your administrator to grant access
   - Check: https://github.com/orgs/games-vector/packages

5. **Wrong Registry Configuration:**
   - Verify `.npmrc` has correct format:
     ```
     @games-vector:registry=https://npm.pkg.github.com
     //npm.pkg.github.com/:_authToken=YOUR_TOKEN
     ```
   - Ensure `.npmrc` is in the `vector-games-v2` directory root

6. **Package Not Published:**
   - Verify package exists: https://github.com/games-vector/game-platform-core/packages
   - If package doesn't exist, you may need to use local package (see Option 2 in GitHub Packages Access section)

#### 2. Database Connection Error

**Error:** `ER_ACCESS_DENIED_ERROR` or connection refused

**Solution:**
- Verify MySQL is running: `mysql -u root -p`
- Check database credentials in `.env`
- Ensure database exists: `SHOW DATABASES;`
- Verify user permissions: `SHOW GRANTS FOR 'vectorgames_user'@'localhost';`

#### 3. Redis Connection Error

**Error:** `ECONNREFUSED` when connecting to Redis

**Solution:**
- Verify Redis is running: `redis-cli ping`
- Check Redis host/port in `.env`
- Ensure Redis is accessible: `redis-cli -h localhost -p 6379`

#### 4. Port Already in Use

**Error:** `EADDRINUSE: address already in use :::3000`

**Solution:**
- Change `APP_PORT` in `.env` to a different port
- Or kill the process using port 3000:
  ```bash
  # Linux/Mac
  lsof -ti:3000 | xargs kill -9
  
  # Windows
  netstat -ano | findstr :3000
  taskkill /PID <PID> /F
  ```

#### 5. TypeORM Synchronization Issues

**Error:** Table creation errors or schema conflicts

**Solution:**
- For development: Set `DB_SYNCHRONIZE=true` (auto-creates tables)
- For production: Set `DB_SYNCHRONIZE=false` and use migrations
- Drop and recreate database if needed:
  ```sql
  DROP DATABASE vectorgames;
  CREATE DATABASE vectorgames CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
  ```

#### 6. Build Errors

**Error:** TypeScript compilation errors

**Solution:**
- Clean build: `rm -rf dist` then `npm run build`
- Check TypeScript version: `npm list typescript`
- Verify all dependencies installed: `npm install --legacy-peer-deps`

#### 7. Missing Game Configurations

**Error:** Game not found or configuration errors

**Solution:**
- Run SQL initialization scripts:
  ```bash
  mysql -u vectorgames_user -p vectorgames < coefficient-distribution-setup.sql
  mysql -u vectorgames_user -p vectorgames < diver-game-setup.sql
  ```
- Verify game records exist in `games` table:
  ```sql
  SELECT * FROM games;
  ```

### Getting Help

If you encounter issues not covered here:

1. Check application logs in `logs/` directory
2. Review console output for error messages
3. Verify all environment variables are set correctly
4. Ensure all prerequisites are installed and running
5. Check the [Architecture Documentation](./ARCHITECTURE_AND_ONBOARDING.md) for more details

---

## Next Steps

After successful setup:

1. **Read Architecture Documentation:**
   - [ARCHITECTURE_AND_ONBOARDING.md](./ARCHITECTURE_AND_ONBOARDING.md) - Understanding the system architecture
   - [QUICK_REFERENCE.md](./QUICK_REFERENCE.md) - Quick reference guide

2. **Configure Games:**
   - Set up game-specific configurations in the database
   - Configure game coefficients and RTP settings

3. **Set Up Frontend:**
   - Connect your frontend application to the backend
   - Configure WebSocket connections

4. **Production Deployment:**
   - Review [DEPLOYMENT.md](./DEPLOYMENT.md) for production setup
   - Configure SSL/TLS certificates
   - Set up monitoring and logging

---

## Summary

You should now have:

✅ Node.js, MySQL, and Redis installed and running  
✅ Repository cloned and dependencies installed  
✅ Database created and configured  
✅ Environment variables configured  
✅ Application running on port 3000  
✅ Swagger documentation accessible  
✅ Database initialized with game configurations  

The Vector Games V2 backend is now ready for development!
