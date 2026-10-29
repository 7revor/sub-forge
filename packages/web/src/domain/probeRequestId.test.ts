import { afterEach, expect, it, vi } from 'vitest';
import { createProbeRequestId } from './probeRequestId.ts';

afterEach(() => vi.unstubAllGlobals());
it('没有 randomUUID 的 HTTP 上下文仍能生成符合接口要求的唯一标识', () => {
  const getRandomValues = crypto.getRandomValues.bind(crypto);
  vi.stubGlobal('crypto', { getRandomValues });
  const ids = Array.from({ length: 100 }, () => createProbeRequestId());
  expect(new Set(ids).size).toBe(100);
  for (const id of ids) expect(id).toMatch(/^[a-zA-Z0-9-]{16,64}$/);
});
