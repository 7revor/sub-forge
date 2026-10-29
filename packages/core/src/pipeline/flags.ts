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
  { flag: '🇲🇩', pattern: /摩尔多瓦|摩爾多瓦|\bMD\b|Moldova/i },
  { flag: '🇺🇦', pattern: /乌克兰|烏克蘭|\bUA\b|Ukraine/i },
  { flag: '🇮🇹', pattern: /意大利|義大利|\bIT\b|Italy/i },
  { flag: '🇭🇺', pattern: /匈牙利|\bHU\b|Hungary/i },
  { flag: '🇪🇸', pattern: /西班牙|\bES\b|Spain/i },
  { flag: '🇨🇦', pattern: /加拿大|\bCA\b|Canada/i },
  { flag: '🇧🇷', pattern: /巴西|\bBR\b|Brazil/i },
  { flag: '🇨🇱', pattern: /智利|\bCL\b|Chile/i },
  { flag: '🇦🇺', pattern: /澳大利亚|澳洲|悉尼|\bAU\b|Australia|Sydney/i },
  { flag: '🇳🇿', pattern: /新西兰|紐西蘭|\bNZ\b|New\s?Zealand/i },
  { flag: '🇮🇩', pattern: /印度尼西亚|印度尼西亞|印尼|\bID\b|Indonesia/i },
  { flag: '🇮🇳', pattern: /印度|孟买|\bIN\b|India|Mumbai/i },
  { flag: '🇵🇰', pattern: /巴基斯坦|\bPK\b|Pakistan/i },
  { flag: '🇮🇱', pattern: /以色列|\bIL\b|Israel/i },
  { flag: '🇦🇪', pattern: /阿联酋|阿聯酋|\bAE\b|\bUAE\b|United\s?Arab\s?Emirates/i },
  { flag: '🇪🇬', pattern: /埃及|\bEG\b|Egypt/i },
  { flag: '🇳🇬', pattern: /尼日利亚|奈及利亞|\bNG\b|Nigeria/i },
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
// 上游常把流量、到期等说明伪装成代理节点；其中的 GB 是流量单位，不是英国地区代码。
const INFO_NODE = /^\s*(?:(?:traffic|expire|remaining|upload|download|used|total|reset)\b|(?:剩余流量|已用流量|总流量|流量|到期|过期|有效期|套餐|官网|网址|客服))/i;

export function detectFlag(name: string): string | undefined {
  if (INFO_NODE.test(name)) return undefined;
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
