/** 出站节点、TLS、传输层及对应协议的中文文档：
 * https://wiki.metacubex.one/config/proxies/
 * https://wiki.metacubex.one/config/proxies/tls/
 * https://wiki.metacubex.one/config/proxies/transport/
 */
export const proxyPlaceholders = {
  name: '在配置中标识这个代理节点的名称',
  type: '选择连接代理服务器所用的协议',
  server: '代理服务器的域名或 IP 地址',
  port: '代理服务器接收连接的端口',
  password: '代理服务器用于身份验证的密码',
  uuid: '与服务器配置一致的用户 UUID',
  cipher: '选择与服务器一致的加密算法',
  plugin: 'Shadowsocks 插件名称，如 obfs 或 v2ray-plugin',
  'plugin-opts': '填写所选 Shadowsocks 插件的参数',
  alterId: 'VMess 额外用户 ID 数量，AEAD 使用 0',
  flow: '选择与 VLESS 服务器一致的流控方式',
  obfs: '选择 Hysteria 2 的混淆方式',
  'obfs-password': '与服务器一致的混淆密码',
  up: '上传带宽上限，如 100 Mbps',
  down: '下载带宽上限，如 100 Mbps',
  ports: '跳跃端口或范围，如 20000-30000',
  'congestion-controller': '选择 TUIC 传输的拥塞控制算法',
  'udp-relay-mode': '选择 TUIC 转发 UDP 的方式',
  username: '代理服务器用于身份验证的用户名',
  network: '选择连接服务器使用的传输方式',
  'ws-opts.path': 'WebSocket 请求路径，如 /ws',
  'ws-opts.headers.Host': 'WebSocket 请求头中的主机名',
  'grpc-opts.grpc-service-name': '与服务器配置一致的 gRPC 服务名称',
  tls: '是否对代理连接启用 TLS 加密',
  servername: 'TLS 握手使用的服务器名称',
  sni: 'TLS 握手使用的服务器名称',
  'skip-cert-verify': '是否跳过对服务器 TLS 证书的校验',
  'client-fingerprint': '选择 TLS 握手模拟的客户端指纹',
  alpn: 'TLS 协商的应用协议，如 h2，每行一项',
  'reality-opts.public-key': 'Reality 服务器提供的公钥',
  'reality-opts.short-id': 'Reality 服务器允许的短 ID',
  udp: '是否允许此节点转发 UDP 流量',
  tfo: '是否启用 TCP Fast Open 加速连接建立',
  'ip-version': '选择解析服务器域名时使用的 IP 版本',
} as const;

/** https://wiki.metacubex.one/config/proxy-groups/ */
export const groupPlaceholders = {
  type: '选择手动选择、测速选择、故障回退或负载均衡',
  url: '用于检测代理可用性的 HTTP 地址',
  interval: '定时检查的间隔秒数，0 表示不定时检查',
  timeout: '一次可用性检查允许等待的毫秒数',
  maxFailedTimes: '累计失败多少次后触发强制检查',
  expectedStatus: '检测通过所需的 HTTP 状态码，如 204 或 200-299',
  tolerance: '自动切换节点所需的延迟改善幅度，单位为毫秒',
  lazy: '是否在策略组未被选中时暂停检测',
  strategy: '选择负载均衡时分配连接的算法',
  hidden: '是否在控制面板中隐藏此策略组',
  icon: '控制面板显示的策略组图标地址',
} as const;

/** 代理链的 Provider 与 Inline 默认全部节点，使用筛选定位前置，再按 dialer-proxy 连接落地。
 * https://wiki.metacubex.one/config/proxy-groups/#filter
 * https://wiki.metacubex.one/config/proxies/dialer-proxy/
 */
export const chainPlaceholders = {
  viaFilter: '全部',
} as const;
