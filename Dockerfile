FROM oven/bun:1-alpine AS build
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production
COPY src/ src/

FROM oven/bun:1-alpine
WORKDIR /app
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/src src
COPY --from=build /app/package.json .
RUN mkdir -p /data

EXPOSE 3000
CMD ["bun", "run", "src/index.ts"]
