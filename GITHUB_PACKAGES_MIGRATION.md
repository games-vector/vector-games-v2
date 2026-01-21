# Migration to GitHub Packages - Complete Guide

## ✅ What Changed

1. **Package Name**: `@vector-games/game-core` → `@games-vector/game-core`
2. **Package Source**: Local file → GitHub Packages (private npm registry)
3. **Docker Build**: No longer builds package locally, fetches from GitHub Packages

## 📋 Step-by-Step Setup

### Step 1: Create GitHub Personal Access Token

1. Go to: https://github.com/settings/tokens
2. Click "Generate new token (classic)"
3. Name: `vector-games-packages`
4. Select scopes:
   - ✅ `write:packages` (to publish)
   - ✅ `read:packages` (to install)
   - ✅ `repo` (if repository is private)
5. Generate and **copy the token** (you won't see it again!)

### Step 2: Publish game-platform-core to GitHub Packages

```bash
cd game-platform-core

# Create .npmrc (if not exists)
cat > .npmrc << EOF
@games-vector:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=YOUR_GITHUB_TOKEN
EOF

# Build and publish
npm run build
npm run publish:github
```

Verify at: https://github.com/orgs/games-vector/packages

### Step 3: Configure vector-games-v2 for Local Development

```bash
cd vector-games-v2

# Create .npmrc
cat > .npmrc << EOF
@games-vector:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=YOUR_GITHUB_TOKEN
EOF

# Install dependencies
npm install
```

### Step 4: Configure for Docker/Production

Add to `.env.production`:
```
GITHUB_TOKEN=your_github_token_here
```

Then build:
```bash
docker compose -f docker-compose.prod.yml --env-file .env.production build
```

## 🔄 Benefits

- ✅ No more file path issues
- ✅ No more integrity check failures
- ✅ Proper versioning
- ✅ Cleaner Docker builds
- ✅ Better dependency management
- ✅ Works across different environments

## 🚨 Important Notes

1. **Never commit `.npmrc`** - It contains your token (already in `.gitignore`)
2. **Token expires** - Regenerate if you get 401 errors
3. **Organization access** - Ensure you have access to `games-vector` org
4. **Version updates** - Update version in `package.json` before publishing

## 📦 Publishing New Versions

```bash
cd game-platform-core

# Update version in package.json
# "version": "1.0.1"

# Build and publish
npm run build
npm run publish:github
```

Then update `vector-games-v2/package.json`:
```json
"@games-vector/game-core": "^1.0.1"
```

## 🐛 Troubleshooting

### Error: 401 Unauthorized
- Token expired or invalid
- Token missing required scopes
- Check `.npmrc` has correct token

### Error: 403 Forbidden
- No access to `games-vector` organization
- Package name mismatch

### Error: Package not found
- Package not published yet
- Wrong package name in `package.json`
- Check: https://github.com/orgs/games-vector/packages
