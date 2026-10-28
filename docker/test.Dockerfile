# 验证用镜像：Node 22 + mihomo 内核 + GeoIP 数据库，用来跑需要真实内核的测试。
# 构建时联网下载并校验 SHA-256；运行时用 --network none，所有连接都只在容器内的回环地址上。
#
#   docker build -f docker/test.Dockerfile -t sub-forge-test .
#   docker run --rm --network none sub-forge-test
#
# 版本与摘要来自 GitHub release 页面公布的 digest。

FROM node:22-bookworm-slim@sha256:3ed748ce9dea62d2f0f0205cdbb6823106d9f973a6f555c402fe2575f8d6e1ae

ARG TARGETARCH
ARG MIHOMO_VERSION=v1.19.33
ARG MIHOMO_SHA256_arm64=ba408b317080ee265c46cb923a50018c1b82cbd708551cdd46a1e3e307396187
ARG MIHOMO_SHA256_amd64=132f6f3edf9a65e62f04853aed3358472e0b2b7666daa8419edfa2ddf5bb6323
# Loyalsoldier/geoip 的精简版（只含 CN 与私有地址），足够校验 GEOIP 规则
ARG GEOIP_TAG=202610230445
ARG GEOIP_SHA256=85ef4144851be2860952e7a15df08efbf266d536e5fb05d77afb6e714e9d9a9d

RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl python3 make g++ \
 && rm -rf /var/lib/apt/lists/*

RUN set -eux; \
    case "$TARGETARCH" in arm64) sha="$MIHOMO_SHA256_arm64" ;; amd64) sha="$MIHOMO_SHA256_amd64" ;; *) echo "不支持的架构 $TARGETARCH"; exit 1 ;; esac; \
    mkdir -p /opt/mihomo; cd /opt/mihomo; \
    curl -fsSL -o mihomo.gz "https://github.com/MetaCubeX/mihomo/releases/download/${MIHOMO_VERSION}/mihomo-linux-${TARGETARCH}-${MIHOMO_VERSION}.gz"; \
    echo "${sha}  mihomo.gz" | sha256sum -c -; \
    gunzip mihomo.gz; chmod +x mihomo; ./mihomo -v; \
    curl -fsSL -o Country.mmdb "https://github.com/Loyalsoldier/geoip/releases/download/${GEOIP_TAG}/Country-only-cn-private.mmdb"; \
    echo "${GEOIP_SHA256}  Country.mmdb" | sha256sum -c -

RUN corepack enable && corepack prepare pnpm@10.18.1 --activate

WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/core/package.json packages/core/
COPY packages/server/package.json packages/server/
RUN pnpm install --frozen-lockfile
COPY packages packages

ENV MIHOMO=/opt/mihomo/mihomo \
    MIHOMO_MMDB=/opt/mihomo/Country.mmdb \
    MIHOMO_RUNTIME=1

CMD ["pnpm", "test"]
