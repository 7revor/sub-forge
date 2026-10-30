/** 按 Mihomo 中文配置文档整理；这里只提供输入提示，不参与默认值或配置输出。
 * https://wiki.metacubex.one/config/general/
 * https://wiki.metacubex.one/config/dns/
 * https://wiki.metacubex.one/config/sniff/
 * https://wiki.metacubex.one/config/inbound/port/
 * https://wiki.metacubex.one/config/inbound/tun/
 */
export const mihomoBasePlaceholders = {
  'mixed-port': '同时接收 HTTP 和 SOCKS 请求的端口',
  port: '接收 HTTP 代理请求的端口',
  'socks-port': '接收 SOCKS 代理请求的端口',
  'allow-lan': '是否允许局域网设备连接代理',
  'bind-address': '允许访问的监听地址，* 表示所有地址',
  mode: '选择按规则分流、全局代理或全局直连',
  'log-level': '选择内核输出日志的详细程度',
  ipv6: '是否接收 IPv6 流量',
  'unified-delay': '是否用 RTT 统一不同协议节点的延迟计算',
  'tcp-concurrent': '是否并发连接解析出的 IP 并采用最快连接',
  'find-process-mode': '选择强制、按需或关闭进程匹配',
  'global-client-fingerprint': '全局 TLS 指纹已弃用，请在节点中配置',
  'profile.store-selected': '是否保存策略组选择并在重启后恢复',
  'profile.store-fake-ip': '是否保存域名与虚拟 IP 的映射',
  'external-controller': '控制 API 的监听地址和端口，如 127.0.0.1:9090',
  'external-ui': '控制面板静态文件所在的目录',
  secret: '访问控制 API 时使用的密钥',
  'dns.enable': '是否启用内置 DNS 解析服务',
  'dns.listen': 'DNS 服务的监听地址和端口，如 127.0.0.1:1053',
  'dns.ipv6': '是否解析并返回 IPv6 地址',
  'dns.enhanced-mode': '选择虚拟 IP 或真实 IP 的 DNS 处理模式',
  'dns.fake-ip-range': '分配虚拟 IPv4 的网段，如 198.18.0.1/16',
  'dns.fake-ip-filter': '配置虚拟 IP 的域名过滤条件，每行一项',
  'dns.default-nameserver': '用于解析 DNS 服务器域名的 IP 地址，每行一项',
  'dns.nameserver': '常规域名查询使用的 DNS 服务器，每行一项',
  'dns.fallback': '备用 DNS 服务器地址，每行一项',
  'dns.fallback-filter.geoip': '是否根据 IP 所属国家判断是否采用备用解析',
  'dns.fallback-filter.geoip-code': '可信解析结果所属国家的缩写，如 CN',
  'dns.nameserver-policy': '为匹配的域名指定 DNS 服务器',
  'dns.proxy-server-nameserver': '专门解析代理节点域名的 DNS，每行一项',
  'dns.direct-nameserver': '直连出口解析域名使用的 DNS，每行一项',
  'dns.respect-rules': '是否让 DNS 连接按路由规则分流，需配置节点域名 DNS',
  'sniffer.enable': '是否从连接内容识别目标域名',
  'sniffer.force-dns-mapping': '是否强制嗅探 redir-host 映射的连接',
  'sniffer.parse-pure-ip': '是否嗅探尚未取得域名的 IP 连接',
  'sniffer.override-destination': '是否把嗅探到的域名用于实际连接',
  'tun.enable': '是否启用 TUN 虚拟网卡接管流量',
  'tun.stack': '选择 TUN 处理网络流量的协议栈',
  'tun.auto-route': '是否自动把全局流量路由到 TUN 网卡',
  'tun.auto-detect-interface': '是否自动识别流量出口网卡',
  'tun.strict-route': '是否在自动路由时执行严格路由限制',
  'tun.dns-hijack': '转交内置 DNS 的请求地址，如 any:53，每行一项',
  'tun.mtu': 'TUN 网卡单个数据包的最大字节数',
  'geodata-mode': '是否使用 DAT 格式的 GEOIP 数据，关闭则使用 MMDB',
  'geo-auto-update': '是否自动下载更新地理位置数据',
  'geo-update-interval': '地理位置数据的更新周期，单位为小时',
  'geox-url.geoip': 'GEOIP DAT 数据文件的下载地址',
  'geox-url.geosite': 'GEOSITE 域名数据文件的下载地址',
  'geox-url.mmdb': 'GEOIP MMDB 数据文件的下载地址',
} as const;

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

/** 代理链使用 Provider 筛选定位前置，再按 dialer-proxy 连接落地。
 * https://wiki.metacubex.one/config/proxy-groups/#filter
 * https://wiki.metacubex.one/config/proxies/dialer-proxy/
 */
export const chainPlaceholders = {
  viaFilter: '输入前置节点关键词或正则，例如 (?i)香港|HK',
} as const;
