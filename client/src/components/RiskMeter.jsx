/**
 * RiskMeter — animated arc gauge showing deadline risk score.
 * Low (green) → Medium (yellow) → High (red)
 */
export default function RiskMeter({ score = 0, size = 'md' }) {
  const isSmall = size === 'sm';
  const radius = isSmall ? 28 : 40;
  const stroke = isSmall ? 5 : 7;
  const cx = radius + stroke;
  const cy = radius + stroke;
  const svgSize = (radius + stroke) * 2;

  // Arc is 3/4 of a circle (270°), starting from bottom-left
  const circumference = 2 * Math.PI * radius;
  const arcLength = circumference * 0.75;
  const offset = arcLength - (score / 100) * arcLength;

  const color =
    score >= 80 ? '#f43f5e'   // rose
    : score >= 55 ? '#f59e0b' // amber
    : score >= 30 ? '#6366f1' // indigo
    : '#10b981';              // emerald

  const label =
    score >= 80 ? 'HIGH'
    : score >= 55 ? 'MED'
    : 'LOW';

  return (
    <div className="flex flex-col items-center gap-1">
      <svg
        width={svgSize}
        height={svgSize}
        viewBox={`0 0 ${svgSize} ${svgSize}`}
        style={{ transform: 'rotate(135deg)' }}
      >
        {/* Track */}
        <circle
          cx={cx}
          cy={cy}
          r={radius}
          fill="none"
          stroke="#1c2136"
          strokeWidth={stroke}
          strokeDasharray={`${arcLength} ${circumference}`}
          strokeLinecap="round"
        />
        {/* Fill */}
        <circle
          cx={cx}
          cy={cy}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeDasharray={`${arcLength} ${circumference}`}
          strokeDashoffset={offset}
          strokeLinecap="round"
          style={{ transition: 'stroke-dashoffset 0.8s ease, stroke 0.5s ease' }}
        />
      </svg>

      {/* Score label (centered over arc) */}
      <div className={`-mt-2 text-center ${isSmall ? 'text-xs' : 'text-sm'}`}>
        <div className="font-bold text-white" style={{ color }}>
          {isSmall ? score : `${score}`}
        </div>
        {!isSmall && (
          <div className="text-[10px] font-semibold tracking-widest" style={{ color }}>
            {label}
          </div>
        )}
      </div>
    </div>
  );
}
