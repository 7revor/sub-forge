import { describe, expect, it } from 'vitest';
import { addFlag, detectFlag, removeFlags } from '../src/pipeline/flags.ts';

describe('地区旗帜', () => {
  it.each([
    ['香港', '🇭🇰'], ['日本', '🇯🇵'], ['新加坡', '🇸🇬'], ['台湾', '🇹🇼'], ['美国', '🇺🇸'],
    ['摩尔多瓦', '🇲🇩'], ['乌克兰', '🇺🇦'], ['意大利', '🇮🇹'], ['匈牙利', '🇭🇺'],
    ['西班牙', '🇪🇸'], ['巴西', '🇧🇷'], ['智利', '🇨🇱'], ['新西兰', '🇳🇿'],
    ['印尼', '🇮🇩'], ['印度尼西亚', '🇮🇩'], ['印度', '🇮🇳'], ['巴基斯坦', '🇵🇰'],
    ['以色列', '🇮🇱'], ['阿联酋', '🇦🇪'], ['埃及', '🇪🇬'], ['尼日利亚', '🇳🇬'],
  ])('花云「%s标准 IEPL 专线 1」添加 %s', (region, flag) => {
    const name = `${region}标准 IEPL 专线 1`;
    expect(detectFlag(name)).toBe(flag);
    expect(addFlag(name)).toBe(`${flag} ${name}`);
    expect(addFlag(addFlag(name))).toBe(`${flag} ${name}`);
  });

  it.each([
    ['Moldova 01', '🇲🇩'], ['UA-01', '🇺🇦'], ['Italy 01', '🇮🇹'], ['HU-01', '🇭🇺'],
    ['Spain 01', '🇪🇸'], ['BR-01', '🇧🇷'], ['Chile 01', '🇨🇱'], ['New Zealand 01', '🇳🇿'],
    ['Indonesia 01', '🇮🇩'], ['PK-01', '🇵🇰'], ['Israel 01', '🇮🇱'], ['UAE 01', '🇦🇪'],
    ['Egypt 01', '🇪🇬'], ['NG-01', '🇳🇬'], ['GB-01', '🇬🇧'],
  ])('英文名称或代码 %s 对应 %s', (name, flag) => {
    expect(addFlag(name)).toBe(`${flag} ${name}`);
  });

  it.each([
    'Traffic: 13.24 GB | 150 GB', 'Expire: 2027-05-19', 'Remaining: 50 GB',
    '流量重置：10 GB', '剩余流量：10 GB', '套餐：100 GB',
  ])('说明节点「%s」不添加旗帜', (name) => {
    expect(detectFlag(name)).toBeUndefined();
    expect(addFlag(name)).toBe(name);
  });

  it('保留已有旗帜，移除操作仍有效', () => {
    expect(addFlag('🇸🇬 新加坡标准 IEPL 专线 1')).toBe('🇸🇬 新加坡标准 IEPL 专线 1');
    expect(removeFlags('🇮🇩 印尼标准 IEPL 专线 1')).toBe('印尼标准 IEPL 专线 1');
  });
});
