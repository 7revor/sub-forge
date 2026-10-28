# 生产镜像（SYS-08）：单容器，订阅接口、管理接口与前端同源；SQLite 与密钥文件放在挂载的 /data。
#
#   docker build -f docker/Dockerfile -t sub-forge .
#   docker run -d --name sub-forge -p 8080:8080 -v sub-forge-data:/data \
#     -e PUBLIC_URL=https://sub.example.com \
#     -e SUBFORGE_ADMIN_USERNAME=admin -e SUBFORGE_ADMIN_PASSWORD=请改成强密码 \
#     sub-forge
#
# 首次启动且没有用户时按 SUBFORGE_ADMIN_* 创建管理员；之后这两个变量可以去掉。

# 前端构建需要开发依赖（Vite 等），单独一个阶段，只把 dist 带走
FROM node:22-bookworm-slim@sha256:3ed748ce9dea62d2f0f0205cdbb6823106d9f973a6f555c402fe2575f8d6e1ae AS web
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@10.18.1 --activate
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/core/package.json packages/core/
COPY packages/server/package.json packages/server/
COPY packages/web/package.json packages/web/
RUN pnpm install --frozen-lockfile
COPY packages/core/src packages/core/src
COPY packages/web packages/web
RUN pnpm --filter @sub-forge/web build

FROM node:22-bookworm-slim@sha256:3ed748ce9dea62d2f0f0205cdbb6823106d9f973a6f555c402fe2575f8d6e1ae AS build
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@10.18.1 --activate
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/core/package.json packages/core/
COPY packages/server/package.json packages/server/
RUN pnpm install --frozen-lockfile --prod --filter @sub-forge/server...
COPY packages/core/src packages/core/src
COPY packages/server/src packages/server/src

FROM node:22-bookworm-slim@sha256:3ed748ce9dea62d2f0f0205cdbb6823106d9f973a6f555c402fe2575f8d6e1ae
ENV NODE_ENV=production \
    SUBFORGE_DB=/data/sub-forge.db \
    HOST=0.0.0.0 \
    PORT=8080 \
    WEB_DIR=/app/packages/web/dist
WORKDIR /app
COPY --from=build /app /app
COPY --from=web /app/packages/web/dist /app/packages/web/dist
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
WORKDIR /app/packages/server
ENTRYPOINT ["./node_modules/.bin/tsx", "src/cli.ts"]
CMD ["serve"]
