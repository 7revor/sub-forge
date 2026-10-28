/** 解析器的直接产物：尚未附加隐式字段的节点 */
export type RawProxy = {
  name: string;
  type: string;
  server: string;
  port: number;
  [k: string]: unknown;
};
