# Utilise Node 20 LTS pour éviter les incompatibilités de better-sqlite3 avec Node 24
FROM node:20-bookworm-slim

# Toolchain pour éventuels modules natifs (better-sqlite3, etc.)
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ bash \
 && rm -rf /var/lib/apt/lists/*

# Entrypoint (et corriger le +X -> +x)
COPY docker/entrypoint.sh /sbin/entrypoint.sh
RUN chmod +x /sbin/entrypoint.sh

# Crée l'utilisateur 1001 (Debian/Ubuntu)
RUN useradd --shell /bin/bash user -u 1001 user

WORKDIR /app

# Copie d’abord les manifests pour tirer parti du cache
COPY package*.json ./

# Propriété avant install
RUN chown -R 1001:1001 /app
RUN chmod -R 700 /app
USER 1001

# Install (préfère npm ci si lockfile présent)
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi

# Copie du reste du code + .env
COPY . .
COPY docker/.env.docker .env

ENV NODE_ENV=production

ENTRYPOINT ["/sbin/entrypoint.sh"]