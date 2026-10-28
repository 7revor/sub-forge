// 地区识别与旗帜。按表顺序匹配，第一个命中的地区生效；顺序本身是确定性的一部分。

type Region = { flag: string; pattern: RegExp };

const REGIONS: Region[] = [
  { flag: '🇭🇰', pattern: /香港|港|\bHK\b|HKG|Hong\s?Kong/i },
  { flag: '🇹🇼', pattern: /台湾|台灣|台北|\bTW\b|Taiwan/i },
  { flag: '🇯🇵', pattern: /日本|东京|東京|大阪|\bJP\b|Japan|Tokyo|Osaka/i },
  { flag: '🇸🇬', pattern: /新加坡|狮城|\bSG\b|Singapore/i },
  { flag: '🇰🇷', pattern: /韩国|韓國|首尔|\bKR\b|Korea|Seoul/i },
  { flag: '🇺🇸', pattern: /美国|美國|洛杉矶|圣何塞|硅谷|\bUS\b|USA|United\s?States|Los\s?Angeles|San\s?Jose/i },
  { flag: '🇬🇧', pattern: /英国|英國|伦敦|\bUK\b|\bGB\b|United\s?Kingdom|London/i },
  { flag: '🇩🇪', pattern: /德国|德國|法兰克福|\bDE\b|Germany|Frankfurt/i },
  { flag: '🇫🇷', pattern: /法国|法國|巴黎|\bFR\b|France|Paris/i },
  { flag: '🇳🇱', pattern: /荷兰|荷蘭|阿姆斯特丹|\bNL\b|Netherlands|Amsterdam/i },
  { flag: '🇨🇦', pattern: /加拿大|\bCA\b|Canada/i },
  { flag: '🇦🇺', pattern: /澳大利亚|澳洲|悉尼|\bAU\b|Australia|Sydney/i },
  { flag: '🇮🇳', pattern: /印度|孟买|\bIN\b|India|Mumbai/i },
  { flag: '🇷🇺', pattern: /俄罗斯|俄羅斯|莫斯科|\bRU\b|Russia|Moscow/i },
  { flag: '🇹🇷', pattern: /土耳其|\bTR\b|Turkey|Türkiye/i },
  { flag: '🇦🇷', pattern: /阿根廷|\bAR\b|Argentina/i },
  { flag: '🇲🇾', pattern: /马来西亚|\bMY\b|Malaysia/i },
  { flag: '🇹🇭', pattern: /泰国|\bTH\b|Thailand/i },
  { flag: '🇻🇳', pattern: /越南|\bVN\b|Vietnam/i },
  { flag: '🇵🇭', pattern: /菲律宾|\bPH\b|Philippines/i },
  { flag: '🇨🇳', pattern: /中国|回国|\bCN\b|China/i },
];

/** 名称开头的国旗（一对区域指示符） */
const LEADING_FLAG = /^[\u{1F1E6}-\u{1F1FF}]{2}\s*/u;
const ANY_FLAG = /[\u{1F1E6}-\u{1F1FF}]{2}/gu;

export function detectFlag(name: string): string | undefined {
  return REGIONS.find((r) => r.pattern.test(name))?.flag;
}

export function addFlag(name: string): string {
  if (LEADING_FLAG.test(name)) return name;
  const flag = detectFlag(name);
  return flag ? `${flag} ${name}` : name;
}

export function removeFlags(name: string): string {
  return name.replace(ANY_FLAG, '').replace(/\s{2,}/g, ' ').trim();
}
