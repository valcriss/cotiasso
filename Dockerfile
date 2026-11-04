# Images de production : `--target api`, `web`, `migrate` et `backup`.
# docker build --target api -t cotiasso-api:<version> .
# docker build --target web -t cotiasso-web:<version> .

ARG NODE_IMAGE=node:26.12.1-bookworm-slim
# Exécution de l'API : Alpine (pas de module natif dans les dépendances d'exécution), bien plus léger que Debian.
ARG NODE_RUNTIME_IMAGE=node:26.12.1-alpine
ARG NGINX_IMAGE=nginxinc/nginx-unprivileged:1.30-alpine

# ---------- Construction : dépendances complètes, client Prisma, compilation ----------
FROM ${NODE_IMAGE} AS build
WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/accounting-domain/package.json packages/accounting-domain/
RUN npm ci

COPY . .
RUN npm run db:generate && npm run build

# ---------- Dépendances d'exécution de l'API uniquement ----------
FROM ${NODE_RUNTIME_IMAGE} AS api-deps
WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY packages/accounting-domain/package.json packages/accounting-domain/
RUN npm ci --omit=dev --omit=optional --workspace=@cotiasso/api --workspace=@cotiasso/accounting-domain && mkdir -p apps/api/node_modules packages/accounting-domain/node_modules

# ---------- API ----------
FROM ${NODE_RUNTIME_IMAGE} AS api
ENV NODE_ENV=production \
    API_HOST=0.0.0.0 \
    API_PORT=3000
WORKDIR /app/apps/api

COPY --from=api-deps --chown=node:node /app/node_modules /app/node_modules
# Dépendances que npm ne hisse pas à la racine (versions en conflit avec un autre workspace) : sans elles, le démarrage échoue.
COPY --from=api-deps --chown=node:node /app/apps/api/node_modules /app/apps/api/node_modules
COPY --from=api-deps --chown=node:node /app/packages/accounting-domain/node_modules /app/packages/accounting-domain/node_modules
COPY --from=build --chown=node:node /app/packages/accounting-domain/package.json /app/packages/accounting-domain/package.json
COPY --from=build --chown=node:node /app/packages/accounting-domain/dist /app/packages/accounting-domain/dist
COPY --from=build --chown=node:node /app/apps/api/package.json ./package.json
COPY --from=build --chown=node:node /app/apps/api/dist ./dist
COPY --chown=node:node CHANGELOG.md /app/CHANGELOG.md

# Stockage privé des documents : volume persistant, écrit par l'utilisateur non privilégié.
ENV DOCUMENTS_DIR=/data/documents \
    CHANGELOG_FILE=/app/CHANGELOG.md
RUN mkdir -p /data/documents && chown node:node /data/documents
VOLUME ["/data/documents"]

USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.API_PORT+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/main.js"]

# ---------- Migrations : CLI Prisma et schéma, exécutés une fois avant l'API ----------
# Image séparée pour que l'API n'embarque pas le CLI Prisma (plusieurs centaines de Mo) : même version que celle de l'API.
FROM ${NODE_IMAGE} AS migrate
ENV NODE_ENV=production
WORKDIR /app
COPY apps/api/package.json /tmp/api-package.json
RUN PRISMA_VERSION="$(node -p "require('/tmp/api-package.json').devDependencies.prisma")" \
    && npm install --no-save --no-audit --no-fund --omit=dev "prisma@${PRISMA_VERSION}" dotenv@18.0.9 \
    && npm cache clean --force && rm /tmp/api-package.json \
    && chown -R node:node /app
COPY --from=build --chown=node:node /app/apps/api/prisma ./prisma
COPY --from=build --chown=node:node /app/apps/api/prisma.config.ts ./prisma.config.ts
USER node
ENTRYPOINT ["node_modules/.bin/prisma", "migrate", "deploy"]

# ---------- Sauvegarde : pg_dump à la version du serveur, chiffrement, restauration et vérification ----------
# Image séparée de l'API pour ne pas l'alourdir : l'API ne contient aucun outil de sauvegarde.
FROM postgres:17-alpine AS backup
RUN apk add --no-cache bash openssl tar coreutils rclone
COPY docker/backup.sh /usr/local/bin/backup.sh
RUN chmod +x /usr/local/bin/backup.sh
ENTRYPOINT ["/usr/local/bin/backup.sh"]
CMD ["run"]

# ---------- Web : fichiers statiques servis par nginx, /api proxifié vers l'API ----------
FROM ${NGINX_IMAGE} AS web
ENV TRUSTED_PROXY_CIDR=127.0.0.1/32
COPY docker/nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /app/apps/web/dist/web/browser /usr/share/nginx/html
EXPOSE 8080
