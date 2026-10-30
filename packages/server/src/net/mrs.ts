// MRS v1 结构依据 Mihomo 官方读取器；只解码数据，不调用外部程序。
// https://github.com/MetaCubeX/mihomo/blob/Meta/rules/provider/mrs_reader.go
// https://github.com/MetaCubeX/mihomo/blob/Meta/component/trie/domain_set_bin.go
// https://github.com/MetaCubeX/mihomo/blob/Meta/component/cidr/ipcidr_set_bin.go
import { DECODED_MRS_HEADER } from '@sub-forge/core';
import * as zlib from 'node:zlib';
import { promisify } from 'node:util';

const MAX_BYTES = 32 * 1024 * 1024;
const MAX_NODES = 2_000_000;
const MAX_RULES = 1_000_000;
const invalid = () => new Error('MRS 文件结构无效、版本不支持或超过转换上限');
class Reader {
  offset = 0;
  constructor(readonly data: Buffer) {}
  bytes(n: number): Buffer {
    if (!Number.isSafeInteger(n) || n < 0 || n > this.data.length - this.offset) throw invalid();
    const value = this.data.subarray(this.offset, this.offset + n); this.offset += n; return value;
  }
  byte(): number { return this.bytes(1)[0]!; }
  length(max = MAX_BYTES): number {
    const n = this.bytes(8).readBigInt64BE();
    if (n < 0n || n > BigInt(max)) throw invalid();
    return Number(n);
  }
  bitmap(): Buffer { return this.bytes(this.length(Math.floor(this.data.length / 8)) * 8); }
}
const bit = (buf: Buffer, i: number) => {
  if (i < 0 || i >= buf.length * 8) throw invalid();
  return (buf[Math.floor(i / 64) * 8 + 7 - Math.floor(i % 64 / 8)]! >> (i % 8)) & 1;
};

function domains(r: Reader): string[] {
  if (r.byte() !== 1) throw invalid();
  const leaves = r.bitmap(), bitmap = r.bitmap(), labels = r.bytes(r.length(MAX_NODES));
  if (!leaves.length || !bitmap.length || !labels.length) throw invalid();
  const parents = new Int32Array(labels.length + 1), depth = new Uint16Array(labels.length + 1);
  const exact = new Set<string>(), suffix = new Set<string>();
  let position = 0, child = 1, size = 0;
  const decoder = new TextDecoder('utf-8', { fatal: true });
  for (let node = 0; node < child; node++) {
    if (bit(leaves, node)) {
      const path = Buffer.alloc(depth[node]!);
      for (let cursor = node, i = path.length - 1; cursor; cursor = parents[cursor]!) path[i--] = labels[cursor - 1]!;
      const value = [...decoder.decode(path)].reverse().join('');
      if (!value || value.includes('\n') || value.includes('\r')) throw invalid();
      if (value.startsWith('+.')) suffix.add(value.slice(2)); else exact.add(value);
      size += Buffer.byteLength(value) + 24;
      if (size > MAX_BYTES || exact.size + suffix.size > MAX_RULES) throw invalid();
    }
    while (bit(bitmap, position++) === 0) {
      if (child > labels.length || depth[node]! >= 1024) throw invalid();
      parents[child] = node; depth[child] = depth[node]! + 1; child++;
    }
  }
  if (child !== labels.length + 1) throw invalid();
  const lines: string[] = [];
  // MRS 中根域和子域分别存储；成对时合并为 DOMAIN-SUFFIX，单独子域保留通配语义。
  for (const value of suffix) {
    lines.push(exact.delete(value) ? `DOMAIN-SUFFIX,${value}` : `DOMAIN-WILDCARD,*.${value}`);
  }
  for (const value of exact) lines.push(`${/[*?]/.test(value) ? 'DOMAIN-WILDCARD' : 'DOMAIN'},${value}`);
  return lines;
}

function ipRanges(r: Reader): string[] {
  if (r.byte() !== 1) throw invalid();
  const count = r.length(Math.floor((r.data.length - r.offset - 8) / 32));
  const lines: string[] = [];
  const integer = (b: Buffer) => b.readBigUInt64BE() << 64n | b.readBigUInt64BE(8);
  for (let i = 0; i < count; i++) {
    let start = integer(r.bytes(16)), end = integer(r.bytes(16));
    if (start > end) throw invalid();
    const mapped = (n: bigint) => n >> 32n === 0xffffn;
    if (mapped(start) !== mapped(end)) throw invalid();
    const v4 = mapped(start), bits = v4 ? 32 : 128;
    if (v4) { start &= 0xffffffffn; end &= 0xffffffffn; }
    while (start <= end) {
      let shift = 0;
      while (shift < bits && (start & ((1n << BigInt(shift + 1)) - 1n)) === 0n && start + (1n << BigInt(shift + 1)) - 1n <= end) shift++;
      const address = v4 ? [24n, 16n, 8n, 0n].map(s => String(start >> s & 255n)).join('.')
        : [112n, 96n, 80n, 64n, 48n, 32n, 16n, 0n].map(s => (start >> s & 65535n).toString(16)).join(':');
      lines.push(`${v4 ? 'IP-CIDR' : 'IP-CIDR6'},${address}/${bits - shift}`);
      if (lines.length > MAX_RULES) throw invalid();
      start += 1n << BigInt(shift);
    }
  }
  return lines;
}

/** 以压缩魔数识别 MRS，不依赖 URL 扩展名；解码后的 classical 文本继续走统一转换器。 */
export async function decodeRuleBytes(bytes: Buffer, expectedBehavior?: 'domain' | 'ipcidr' | 'classical'): Promise<string> {
  if (bytes.subarray(0, 3).toString('ascii') === 'SRS') throw new Error('暂不支持 SRS 二进制规则，请使用文本或 YAML 来源');
  if (bytes.length < 4 || bytes.readUInt32LE(0) !== 0xfd2fb528) return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  if (typeof zlib.zstdDecompress !== 'function') throw new Error('MRS 转换需要 Node.js 22.15 或更新版本');
  const decoded = await promisify(zlib.zstdDecompress)(bytes, { maxOutputLength: MAX_BYTES });
  const r = new Reader(decoded);
  if (!r.bytes(4).equals(Buffer.from([77, 82, 83, 1]))) throw invalid();
  const behavior = r.byte();
  if (expectedBehavior && (expectedBehavior === 'domain' ? behavior !== 0 : expectedBehavior === 'ipcidr' ? behavior !== 1 : true)) throw new Error('MRS 实际类型与配置的 behavior 不一致');
  r.length(MAX_RULES); // 原始条数用于元数据，实际输出独立设上限。
  r.bytes(r.length()); // 保留字段。
  const lines = behavior === 0 ? domains(r) : behavior === 1 ? ipRanges(r) : (() => { throw invalid(); })();
  if (r.offset !== decoded.length || !lines.length) throw invalid();
  const text = lines.join('\n') + '\n';
  if (Buffer.byteLength(text) > MAX_BYTES) throw invalid();
  return `${DECODED_MRS_HEADER}\n${text}`;
}
