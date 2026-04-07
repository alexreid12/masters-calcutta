export type FlagStatus = 'high_bid' | 'outbid' | 'no_bid';

interface Props {
  status: FlagStatus;
  size?: number;
}

/** Masters-inspired golf flag pin icon. Used to show async bid status. */
export function MastersFlag({ status, size = 20 }: Props) {
  const isHigh = status === 'high_bid';
  const isOutbid = status === 'outbid';

  const poleColor  = isHigh ? '#006747' : isOutbid ? '#9ca3af' : '#d1d5db';
  const flagFill   = isHigh ? '#d4af37' : 'none';
  const flagStroke = isHigh ? '#d4af37' : isOutbid ? '#9ca3af' : '#d1d5db';
  const baseColor  = isHigh ? '#006747' : isOutbid ? '#9ca3af' : '#d1d5db';
  const opacity    = status === 'no_bid' ? 0.35 : 1;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      style={{ transition: 'all 0.3s ease', opacity }}
      aria-label={isHigh ? 'You have the high bid' : isOutbid ? 'You have been outbid' : 'No bid'}
    >
      {/* Vertical pole */}
      <line x1="8" y1="2" x2="8" y2="16.5" stroke={poleColor} strokeWidth="1.5" strokeLinecap="round" />
      {/* Triangular flag at top */}
      <polygon
        points="8,2 15,5.5 8,9"
        fill={flagFill}
        stroke={flagStroke}
        strokeWidth="1"
        strokeLinejoin="round"
      />
      {/* Base ellipse (the cup/hole) */}
      <ellipse cx="8" cy="17" rx="3.5" ry="1.2" fill={baseColor} />
    </svg>
  );
}
