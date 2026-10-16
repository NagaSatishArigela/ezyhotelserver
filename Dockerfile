# Build a reproducible production image for the NestJS API.
FROM node:22-bookworm-slim AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY prisma ./prisma
RUN npm run prisma:generate

COPY tsconfig.json tsconfig.test.json nest-cli.json ./
COPY src ./src
RUN npm run build

# Prisma is deliberately kept in this image: the deployment workflow invokes
# `prisma migrate deploy` from the same, version-matched build before startup.
FROM node:22-bookworm-slim AS runtime

WORKDIR /app
ENV NODE_ENV=production

COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/dist ./dist

RUN mkdir -p uploads && chown -R node:node /app
USER node

EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "require('net').connect({port:process.env.PORT||4000,host:'127.0.0.1'}).on('connect',function(){process.exit(0)}).on('error',function(){process.exit(1)})"

CMD ["node", "dist/main"]
