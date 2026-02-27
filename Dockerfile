# ---- deps ----
FROM node:20-alpine AS deps
WORKDIR /app

# Needed for some node modules (bcrypt, etc.) if you use them
RUN apk add --no-cache libc6-compat

COPY package*.json ./
RUN npm ci

# ---- build ----
FROM node:20-alpine AS build
WORKDIR /app

RUN apk add --no-cache libc6-compat

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Prisma client generation (needs schema)
RUN npx prisma generate

# Build TS -> dist (must exist in package.json)
RUN npm run build

# ---- runtime ----
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

RUN apk add --no-cache libc6-compat

# Only copy runtime essentials
COPY --from=build /app/package*.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/dist ./dist

# Container Apps expects the app to listen on $PORT
ENV PORT=8080
EXPOSE 8080

# IMPORTANT: adjust to your actual entry file:
# e.g. dist/index.js OR dist/src/index.js etc.
COPY --from=build /app/docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x ./docker-entrypoint.sh
CMD ["./docker-entrypoint.sh"]