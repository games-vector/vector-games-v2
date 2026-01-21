#!/bin/bash

# Let's Encrypt SSL Setup Script for Vector Games V2
set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}=== Let's Encrypt SSL Setup for Vector Games V2 ===${NC}"
echo ""

if [ "$EUID" -ne 0 ]; then 
    echo -e "${RED}❌ Run with: sudo ./setup-letsencrypt.sh [domain]${NC}"
    exit 1
fi

# Get domain from argument or use default
DOMAIN_NAME="${1:-api.demolink.games}"

echo -e "${YELLOW}Domain: ${DOMAIN_NAME}${NC}"

# Verify DNS
echo -e "${YELLOW}Checking DNS...${NC}"
SERVER_IP=$(curl -s ifconfig.me 2>/dev/null || echo "165.232.177.221")
DNS_IP=$(dig +short $DOMAIN_NAME 2>/dev/null | tail -n1)

if [ "$DNS_IP" != "$SERVER_IP" ]; then
    echo -e "${RED}❌ DNS mismatch!${NC}"
    echo -e "   Server: $SERVER_IP"
    echo -e "   DNS:    $DNS_IP"
    echo -e "${YELLOW}   Update DNS A record first${NC}"
    exit 1
fi

echo -e "${GREEN}✅ DNS OK${NC}"

# Install certbot
if ! command -v certbot &> /dev/null; then
    echo -e "${YELLOW}Installing certbot...${NC}"
    apt-get update -qq
    apt-get install -y certbot python3-certbot-nginx > /dev/null 2>&1
fi

# Backup current config
BACKUP_DIR="/etc/nginx/backup-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$BACKUP_DIR"
[ -f /etc/nginx/sites-available/vector-games-v2 ] && \
    cp /etc/nginx/sites-available/vector-games-v2 "$BACKUP_DIR/"

# Prepare for ACME challenge
mkdir -p /var/www/html
cat > /etc/nginx/sites-available/vector-games-v2 << EOF
server {
    listen 80;
    server_name $DOMAIN_NAME;
    location /.well-known/acme-challenge/ { root /var/www/html; }
    location / { return 301 https://\$host\$request_uri; }
}
EOF

rm -f /etc/nginx/sites-enabled/vector-games-v2
ln -sf /etc/nginx/sites-available/vector-games-v2 /etc/nginx/sites-enabled/vector-games-v2
nginx -t > /dev/null && systemctl reload nginx > /dev/null

# Get certificate
echo -e "${YELLOW}Getting certificate...${NC}"
certbot certonly --webroot -w /var/www/html -d $DOMAIN_NAME \
    --non-interactive --agree-tos --email games.vector2026@gmail.com 2>&1 | grep -v "^$" || {
    echo -e "${RED}❌ Certificate failed${NC}"
    [ -f "$BACKUP_DIR/vector-games-v2" ] && \
        cp "$BACKUP_DIR/vector-games-v2" /etc/nginx/sites-available/vector-games-v2 && \
        systemctl reload nginx
    exit 1
}

echo -e "${GREEN}✅ Certificate obtained${NC}"

# Update nginx config with SSL
echo -e "${YELLOW}Configuring nginx with SSL...${NC}"

cat > /etc/nginx/sites-available/vector-games-v2 << EOF
upstream backend {
    server 127.0.0.1:3000;
    keepalive 64;
}

# HTTP server - redirect to HTTPS
server {
    listen 80;
    server_name $DOMAIN_NAME;

    # Let's Encrypt ACME challenge
    location /.well-known/acme-challenge/ {
        root /var/www/html;
    }

    # Redirect all other traffic to HTTPS
    location / {
        return 301 https://\$host\$request_uri;
    }
}

# HTTPS server
server {
    listen 443 ssl http2;
    server_name $DOMAIN_NAME;

    # Let's Encrypt certificates
    ssl_certificate /etc/letsencrypt/live/$DOMAIN_NAME/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/$DOMAIN_NAME/privkey.pem;

    # SSL Configuration - Modern and secure
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers 'ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384:ECDHE-ECDSA-CHACHA20-POLY1305:ECDHE-RSA-CHACHA20-POLY1305:DHE-RSA-AES128-GCM-SHA256:DHE-RSA-AES256-GCM-SHA384';
    ssl_prefer_server_ciphers off;
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 10m;
    ssl_session_tickets off;

    # Main application
    location / {
        # Security headers
        add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
        add_header X-Frame-Options "SAMEORIGIN" always;
        add_header X-Content-Type-Options "nosniff" always;
        add_header X-XSS-Protection "1; mode=block" always;

        proxy_pass http://backend;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header X-Forwarded-Host \$host;
        proxy_set_header X-Forwarded-Port \$server_port;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection \$connection_upgrade;
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 86400;
        proxy_buffering off;
        proxy_cache_bypass \$http_upgrade;
    }

    # WebSocket endpoint
    location /io/ {
        proxy_pass http://backend;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_connect_timeout 7d;
        proxy_send_timeout 7d;
        proxy_read_timeout 7d;
        proxy_buffering off;
        proxy_cache off;
    }

    # Health check endpoint
    location /health {
        proxy_pass http://backend;
        access_log off;
    }
}

map \$http_upgrade \$connection_upgrade {
    default upgrade;
    '' close;
}
EOF

# Test and reload nginx
nginx -t && systemctl reload nginx

echo -e "${GREEN}✅ SSL configured successfully!${NC}"
echo ""
echo -e "${BLUE}=== Setup Complete ===${NC}"
echo -e "Domain: ${GREEN}https://$DOMAIN_NAME${NC}"
echo -e "Certificate: ${GREEN}/etc/letsencrypt/live/$DOMAIN_NAME/${NC}"
echo ""
echo -e "${YELLOW}Auto-renewal:${NC}"
echo -e "  Certbot will auto-renew certificates. Test with:"
echo -e "  ${BLUE}sudo certbot renew --dry-run${NC}"
