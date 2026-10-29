// 品牌图形：两段圆弧组成 S，末端节点表示订阅加工后的统一出口；与 public/favicon.svg 保持一致。

export function LogoMark({ size = 24, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" className={className} aria-hidden="true">
      <rect width="32" height="32" rx="8" fill="#2952cc" />
      <path d="M21.5 9.5H13.75a3.25 3.25 0 0 0 0 6.5h4.5a3.25 3.25 0 0 1 0 6.5H10.5" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" />
      <circle cx="22" cy="22.5" r="2" fill="#9fb6f5" />
    </svg>
  );
}
