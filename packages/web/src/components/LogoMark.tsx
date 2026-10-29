// 品牌图形：三路订阅汇入锻造节点，再分流成两路输出；与 public/favicon.svg 保持一致。

export function LogoMark({ size = 24, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" className={className} aria-hidden="true">
      <rect width="32" height="32" rx="7" fill="#2952cc" />
      <g fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round">
        <path d="M6 8.5C11 8.5 11 16 15 16M6 16h9M6 23.5C11 23.5 11 16 15 16" />
        <path d="M17 16C21 16 21 10.5 25.5 10.5M17 16C21 16 21 21.5 25.5 21.5" stroke="#b9c9f7" />
      </g>
      <circle cx="16" cy="16" r="3.4" fill="#fff" />
    </svg>
  );
}
