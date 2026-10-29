/** HTTP 局域网部署也能生成请求标识；不依赖仅安全上下文提供的 randomUUID。 */
export function createProbeRequestId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}
