/** 纯虚构凭据与 example.test 地址；绝不拉取远程订阅。 */
export const loonFull = `[General]
ip-mode = v4-only
dns-server = 223.5.5.5
allow-wifi-access = false
wifi-access-http-port = 7222
wifi-access-socks5-port = 7221
proxy-test-url = https://example.test/204
test-timeout = 3
disable-stun = false
real-ip = *.apple.com,*apple.com
[Host]
*.example.test = server:1.1.1.1
[Proxy]
入口 = VLESS,entry.example.test,443,"00000000-0000-4000-8000-000000000001",transport=tcp,flow=xtls-rprx-vision,public-key="example-public-key",short-id=01234567,udp=true,block-quic=true,over-tls=true,sni=tls.example.test
落地 = Shadowsocks,exit.example.test,8388,aes-128-gcm,"example-password",fast-open=true,udp=true,block-quic=true
[Remote Proxy]
远程 = https://subscription.example.test/list,udp=true,block-quic=true,fast-open=default,vmess-aead=true,skip-cert-verify=true,enabled=true,flexible-sni=false,img-url=paperplane
[Remote Filter]
HK_Filter = NameRegex, FilterKey = "(?i)(港|HK|Hong Kong)"
Test = NodeSelect
[Proxy Chain]
命名链 = 入口,落地,udp=true
地区链 = 香港节点,落地,udp=true
[Proxy Group]
香港节点 = select,HK_Filter,url=https://example.test/204,img-url=paperplane
科学上网 = select,命名链,地区链,落地,香港节点,DIRECT
[Rule]
DOMAIN,example.test,科学上网
IP-CIDR,192.0.2.0/24,DIRECT,no-resolve
FINAL,科学上网
`;
