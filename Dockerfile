# Images de production : `--target api` et `--target web`.
# docker build --target api -t cotiasso-api:<version> .
# docker build --target web -t cotiasso-web:<version> .

ARG NODE_IMAGE=node:26.12.1-bookworm-slim
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
FROM ${NODE_IMAGE} AS api-deps
WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY packages/accounting-domain/package.json packages/accounting-domain/
RUN npm ci --omit=dev --workspace=@cotiasso/api --workspace=@cotiasso/accounting-domain

# ---------- API ----------
FROM ${NODE_IMAGE} AS api
ENV NODE_ENV=production \
    API_HOST=0.0.0.0 \
    API_PORT=3000
WORKDIR /app/apps/api

COPY --from=api-deps --chown=node:node /app/node_modules /app/node_modules
COPY --from=build --chown=node:node /app/packages/accounting-domain/package.json /app/packages/accounting-domain/package.json
COPY --from=build --chown=node:node /app/packages/accounting-domain/dist /app/packages/accounting-domain/dist
COPY --from=build --chown=node:node /app/apps/api/package.json ./package.json
COPY --from=build --chown=node:node /app/apps/api/dist ./dist
COPY --from=build --chown=node:node /app/apps/api/prisma ./prisma
COPY --from=build --chown=node:node /app/apps/api/prisma.config.ts ./prisma.config.ts
COPY --chown=node:node docker/api-entrypoint.sh /usr/local/bin/api-entrypoint
RUN chmod +x /usr/local/bin/api-entrypoint

USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.API_PORT+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["api-entrypoint"]

# ---------- Web : fichiers statiques servis par nginx, /api proxifié vers l'API ----------
FROM ${NGINX_IMAGE} AS web
ENV TRUSTED_PROXY_CIDR=127.0.0.1/32
COPY docker/nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /app/apps/web/dist/web/browser /usr/share/nginx/html
EXPOSE 8080
