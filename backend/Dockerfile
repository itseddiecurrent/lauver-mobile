FROM node:24-bookworm-slim AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY prisma ./prisma
COPY prisma.config.ts tsconfig.json tsconfig.build.json ./
COPY src ./src
ARG PRISMA_GENERATE_DATABASE_URL=postgresql://build:build@localhost:5432/build
RUN DATABASE_URL="$PRISMA_GENERATE_DATABASE_URL" npm run db:generate
RUN npm run build

FROM build AS production-dependencies
RUN npm prune --omit=dev

FROM node:24-bookworm-slim AS runtime

ENV NODE_ENV=production
WORKDIR /app

COPY --from=production-dependencies /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json package-lock.json ./

USER node
EXPOSE 3000

CMD ["node", "dist/server.js"]
