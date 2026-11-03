#!/bin/sh
# 挂载目录的属主由宿主机决定，这里统一授权后再降权运行，部署时不用手动 chown。
set -e
if [ "$(id -u)" = 0 ]; then
  chown -R node:node /data
  exec setpriv --reuid=node --regid=node --init-groups "$@"
fi
exec "$@"
