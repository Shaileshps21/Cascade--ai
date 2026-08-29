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

  // A Tailwind text-color class, consumed by the SVG via `stroke="currentColor"`
  // — this (rather than resolving the CSS var in JS) is what makes the arc
  // repaint automatically on a theme toggle, the same pattern the Dashboard's
  // StatCard donut ring uses.
  const colorClass =
    score >= 80 ? 'text-danger'
    : score >= 55 ? 'text-warning'
    : score >= 30 ? 'text-brand-500'
    : 'text-success';

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
          stroke="currentColor"
          className="text-border"
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
          stroke="currentColor"
          className={colorClass}
          strokeWidth={stroke}
          strokeDasharray={`${arcLength} ${circumference}`}
          strokeDashoffset={offset}
          strokeLinecap="round"
          style={{ transition: 'stroke-dashoffset 0.8s ease' }}
        />
      </svg>

      {/* Score label (centered over arc) */}
      <div className={`-mt-2 text-center ${isSmall ? 'text-xs' : 'text-sm'}`}>
        <div className={`font-bold font-mono tabular-nums ${colorClass}`}>
          {isSmall ? score : `${score}`}
        </div>
        {!isSmall && (
          <div className={`text-[10px] font-semibold tracking-widest ${colorClass}`}>
            {label}
          </div>
        )}
      </div>
    </div>
  );
}
