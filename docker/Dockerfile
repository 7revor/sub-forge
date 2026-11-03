# 生产镜像：单容器，前端、管理接口和订阅接口都走 8080 端口；数据库和密钥放在挂载的 /data。
#
# 发布（开发机）：./scripts/docker-push your-name/sub-forge
# 部署（服务器）：见 docs/24-first-deployment.md
ARG NODE_IMAGE=node:22-bookworm-slim@sha256:3ed748ce9dea62d2f0f0205cdbb6823106d9f973a6f555c402fe2575f8d6e1ae

FROM ${NODE_IMAGE} AS base
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@10.18.1 --activate
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/core/package.json packages/core/
COPY packages/server/package.json packages/server/
COPY packages/web/package.json packages/web/

# 前端构建需要开发依赖，只把 dist 带走
FROM base AS web
RUN pnpm install --frozen-lockfile
COPY packages/core/src packages/core/src
COPY packages/web packages/web
RUN pnpm --filter @sub-forge/web build

FROM base AS server
RUN pnpm install --frozen-lockfile --prod --filter @sub-forge/server...
COPY packages/core/src packages/core/src
COPY packages/server/src packages/server/src

FROM ${NODE_IMAGE}
# git 用于规则仓库
RUN apt-get update \
 && apt-get install -y --no-install-recommends git ca-certificates \
 && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production \
    HOME=/home/node \
    HOST=0.0.0.0 \
    PORT=8080 \
    SUBFORGE_DB=/data/sub-forge.db \
    WEB_DIR=/app/packages/web/dist
COPY --from=server /app /app
COPY --from=web /app/packages/web/dist /app/packages/web/dist
COPY docker/entrypoint.sh /usr/local/bin/sub-forge-entrypoint
RUN mkdir -p /data
VOLUME /data
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
WORKDIR /app/packages/server
ENTRYPOINT ["sub-forge-entrypoint", "./node_modules/.bin/tsx", "src/cli.ts"]
CMD ["serve"]
