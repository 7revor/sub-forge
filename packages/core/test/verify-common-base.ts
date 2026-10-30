/** 使用本机已有官方内核离线校验；所有凭据均为虚构，沙箱禁止网络。 */
import { mkdtempSync, copyFileSync, writeFileSync, rmSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { lowerCommonBase, mergeBase, renderMihomo, renderSurge } from '../src/index.ts';
import { iniFixture, routing } from './fixtures/ini-client.ts';
const dir = mkdtempSync(join(tmpdir(), 'sub-forge-common-'));
const evidence = resolve('../../research/verification/common-base-loon-import-20261030'); mkdirSync(evidence, { recursive:true });
const common = { dnsServers:['223.5.5.5'], dnsIpv6:false, hosts:{'home.example.test':'192.0.2.1'}, dnsPolicy:{'dns.example.test':'1.1.1.1'}, realIpDomains:['real.example.test'], httpPort:7890, socksPort:7891, allowLan:false, testUrl:'http://example.test/204',testTimeoutMs:3000 };
const rows: unknown[] = [];
try {
  for (const file of ['Country.mmdb','ASN.mmdb','geosite.dat','geoip.dat']) {
    const from = '/Applications/Clash Verge.app/Contents/Resources/resources/' + file;
    if (existsSync(from)) copyFileSync(from, join(dir,file));
  }
  for (const client of ['mihomo','surge'] as const) {
    const f = iniFixture(); routing(f).rules=[]; f.profile.nodeSets[0]!.output='inline'; f.common=common;
    f.base=lowerCommonBase(common,client,'macos').base;
    f.nodeSets.locals.nodes!.proxies=[{name:'入口',type:'ss',server:'entry.example.test',port:443,cipher:'aes-128-gcm',password:'example'}, {name:'落地',type:'ss',server:'exit.example.test',port:443,cipher:'aes-128-gcm',password:'example',...(client==='surge'?{'block-quic':true}:{})}];
    f.profile.chains=[{id:'c',landing:{nodeSet:{type:'local',id:'nodes'},filter:'落地'},via:{kind:'node',ref:{nodeSet:{type:'local',id:'nodes'},match:{exact:'入口'}}}}];
    if(client==='mihomo')f.base=mergeBase(f.base,{tun:{enable:true,stack:'mips','auto-route':true,'auto-detect-interface':true,'dns-hijack':['any:53']},dns:{'enhanced-mode':'fake-ip','fake-ip-range':'198.18.0.1/16'}});
    const out=(client==='mihomo'?renderMihomo:renderSurge)(f);
    if(out.report.hasErrors)throw new Error(JSON.stringify(out.report.items));
    const name=client==='mihomo'?'common-mihomo.yaml':'common-surge.conf', path=join(dir,name);writeFileSync(path,out.yaml);writeFileSync(join(evidence,name),out.yaml);
    const bin=client==='mihomo'?'/Applications/Clash Verge.app/Contents/MacOS/verge-mihomo':'/Applications/Surge.app/Contents/Applications/surge-cli';
    if(!existsSync(bin)){rows.push({client,status:'未执行',reason:'本机没有官方校验器'});continue;}
    const args=client==='mihomo'?['-t','-d',dir,'-f',path]:['--check',path];
    const result=spawnSync('/usr/bin/sandbox-exec',['-p','(version 1)(allow default)(deny network*)',bin,...args],{encoding:'utf8',timeout:30_000});
    const log=(result.stdout+result.stderr).replaceAll(dir,'<隔离目录>');rows.push({client,status:result.status===0?'通过':'失败',exitCode:result.status,log});
    if(result.error)throw result.error;
  }
  writeFileSync(join(evidence,'官方校验.json'),JSON.stringify(rows,null,2)+'\n');console.log(JSON.stringify(rows,null,2));
  if(rows.some((r:any)=>r.status==='失败'))process.exitCode=1;
} finally {rmSync(dir,{recursive:true,force:true});}
