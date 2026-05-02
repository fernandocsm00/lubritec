/**
 * LubriConnect — BrandMark
 * Logo proprietário: gota de óleo abrigando o monograma "LC", com brilho dourado e selo rubi.
 * Não reproduz nenhuma marca terceira.
 */

interface BrandMarkProps {
  size?: number;
  tone?: 'dark' | 'light';
  className?: string;
}

export function BrandMark({ size = 32, tone = 'dark', className }: BrandMarkProps) {
  const gradId = `lc-grad-${tone}`;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      fill="none"
      aria-label="LubriConnect"
      className={className}
    >
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={tone === 'light' ? '#1E456C' : '#0B2545'} />
          <stop offset="1" stopColor={tone === 'light' ? '#0B2545' : '#0A1628'} />
        </linearGradient>
      </defs>
      <path
        d="M20 3 C12 14, 5 20, 5 27 a15 15 0 0 0 30 0 C35 20, 28 14, 20 3Z"
        fill={`url(#${gradId})`}
      />
      <path
        d="M14 22 c0 -3 2 -6 5 -7"
        stroke="#E8A317"
        strokeWidth="2"
        strokeLinecap="round"
        fill="none"
      />
      <circle cx="27" cy="16" r="1.6" fill="#C8102E" />
      <text
        x="20"
        y="32"
        textAnchor="middle"
        fontFamily="Geist, Inter, system-ui"
        fontWeight="800"
        fontSize="10"
        fill="#fff"
        letterSpacing="-0.5"
      >
        LC
      </text>
    </svg>
  );
}

interface BrandLockupProps {
  size?: number;
  dark?: boolean;
  showTagline?: boolean;
}

export function BrandLockup({ size = 26, dark = false, showTagline = true }: BrandLockupProps) {
  return (
    <div className="flex items-center gap-2.5">
      <BrandMark size={size} tone={dark ? 'light' : 'dark'} />
      <div className="flex flex-col leading-none">
        <div
          className={`font-extrabold tracking-tight ${dark ? 'text-white' : 'text-lc-ink'}`}
          style={{ fontSize: size * 0.62 }}
        >
          Lubri<span className="text-lc-ruby">Connect</span>
        </div>
        {showTagline && (
          <div
            className={`font-mono uppercase mt-0.5 ${
              dark ? 'text-white/55' : 'text-muted-foreground'
            }`}
            style={{ fontSize: size * 0.3, letterSpacing: '0.18em' }}
          >
            CRM · Pipeline · Inbox
          </div>
        )}
      </div>
    </div>
  );
}
