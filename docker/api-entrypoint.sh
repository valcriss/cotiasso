#!/bin/sh
set -e

# Applique les migrations en attente avant de démarrer. Une installation = une base = une instance d'API.
/app/node_modules/.bin/prisma migrate deploy

exec node dist/main.js
