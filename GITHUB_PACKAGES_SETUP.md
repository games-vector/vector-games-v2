# GitHub Packages Setup for vector-games-v2

## Overview

This project uses `@games-vector/game-core` from GitHub Packages (private npm registry).

## Setup for Local Development

1. **Get GitHub Personal Access Token**
   - Go to: https://github.com/settings/tokens
   - Generate token with `read:packages` permission
   - Copy the token

2. **Create `.npmrc` file** in `vector-games-v2/`:
```
@games-vector:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=YOUR_GITHUB_TOKEN
```

3. **Install dependencies**:
```bash
npm install
```

## Setup for Docker/Production

### Option 1: Using Environment Variable

Add to `.env.production`:
```
GITHUB_TOKEN=your_github_token_here
```

Docker Compose will automatically pass it as build arg.

### Option 2: Using Docker Secrets (Recommended for Production)

1. Create secret:
```bash
echo "your_github_token" | docker secret create github_token -
```

2. Update `docker-compose.prod.yml`:
```yaml
app:
  build:
    secrets:
      - github_token
```

3. Update Dockerfile to use secret:
```dockerfile
# syntax=docker/dockerfile:1
RUN --mount=type=secret,id=github_token \
    echo "//npm.pkg.github.com/:_authToken=$(cat /run/secrets/github_token)" >> .npmrc
```

## Verifying Installation

Check if package is installed:
```bash
npm list @games-vector/game-core
```

Should show:
```
@games-vector/game-core@1.0.0
```

## Troubleshooting

### Package not found during Docker build
- Ensure `GITHUB_TOKEN` is set in `.env.production`
- Check token has `read:packages` permission
- Verify package is published: https://github.com/orgs/games-vector/packages

### 401 Unauthorized
- Token expired or invalid
- Token missing `read:packages` scope
- `.npmrc` not properly configured
