import React from 'react';

export interface ChartPoint {
  label: string;
  value: number;
}

function compact(value: number, unit: 'currency' | 'count'): string {
  if (unit === 'count') {
    if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}m`;
    if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
    return String(Math.round(value));
  }
  const rupees = value / 100;
  if (rupees >= 10_000_000) return `₹${(rupees / 10_000_000).toFixed(1)}Cr`;
  if (rupees >= 100_000) return `₹${(rupees / 100_000).toFixed(1)}L`;
  if (rupees >= 1_000) return `₹${(rupees / 1_000).toFixed(1)}k`;
  return `₹${Math.round(rupees)}`;
}

function full(value: number, unit: 'currency' | 'count'): string {
  if (unit === 'count') return value.toLocaleString('en-IN');
  return `₹${(value / 100).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
}

/**
 * Server-rendered area chart. No chart dependency and no client JavaScript:
 * the SVG is the whole chart, with each point carrying a native title tooltip.
 */
export function OverviewChart({
  points,
  ariaLabel,
  unit = 'currency',
}: {
  points: ChartPoint[];
  ariaLabel: string;
  unit?: 'currency' | 'count';
}) {
  const width = 760;
  const height = 236;
  const left = 54;
  const right = 10;
  const top = 18;
  const bottom = 34;

  const data = points.length > 0 ? points : [{ label: '—', value: 0 }];
  const max = Math.max(...data.map((point) => point.value), 1);
  const innerWidth = width - left - right;
  const innerHeight = height - top - bottom;
  const step = data.length > 1 ? innerWidth / (data.length - 1) : 0;

  const x = (index: number) =>
    data.length > 1 ? left + index * step : left + innerWidth / 2;
  const y = (value: number) => top + innerHeight * (1 - value / max);
  const baseline = top + innerHeight;

  const linePath = data
    .map((point, index) => `${index === 0 ? 'M' : 'L'}${x(index).toFixed(1)},${y(point.value).toFixed(1)}`)
    .join(' ');
  const areaPath = `${linePath} L${x(data.length - 1).toFixed(1)},${baseline} L${x(0).toFixed(1)},${baseline} Z`;

  const gridValues = [0, 0.25, 0.5, 0.75, 1].map((fraction) => max * fraction);

  const labelIndexes = data.length <= 3
    ? data.map((_, index) => index)
    : [0, Math.floor((data.length - 1) / 2), data.length - 1];

  const total = data.reduce((sum, point) => sum + point.value, 0);

  return (
    <figure className="sa-chart" aria-label={ariaLabel}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        aria-hidden="true"
      >
        <defs>
          <linearGradient id="sa-chart-fill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.28" />
            <stop offset="70%" stopColor="#6366f1" stopOpacity="0.06" />
            <stop offset="100%" stopColor="#8b5cf6" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="sa-chart-line" x1="0" x2="1" y1="0" y2="0">
            <stop offset="0%" stopColor="#3b82f6" />
            <stop offset="100%" stopColor="#8b5cf6" />
          </linearGradient>
        </defs>

        {gridValues.map((value) => (
          <g key={value}>
            <line
              x1={left}
              x2={width - right}
              y1={y(value)}
              y2={y(value)}
              stroke="#e8edf4"
              strokeWidth="1"
              vectorEffect="non-scaling-stroke"
            />
            <text
              x={left - 10}
              y={y(value) + 3.5}
              textAnchor="end"
              className="sa-chart-axis"
            >
              {compact(value, unit)}
            </text>
          </g>
        ))}

        {total > 0 ? (
          <>
            <path d={areaPath} fill="url(#sa-chart-fill)" />
            <path
              d={linePath}
              fill="none"
              stroke="url(#sa-chart-line)"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
          </>
        ) : (
          <line
            x1={left}
            x2={width - right}
            y1={baseline}
            y2={baseline}
            stroke="#cbd5e1"
            strokeDasharray="4 5"
            strokeWidth="1.5"
            vectorEffect="non-scaling-stroke"
          />
        )}

        {data.length <= 24
          ? data.map((point, index) => (
              <circle
                key={`${point.label}-${index}`}
                cx={x(index)}
                cy={y(point.value)}
                r="3"
                fill="#fff"
                stroke="#6366f1"
                strokeWidth="1.8"
                vectorEffect="non-scaling-stroke"
              >
                <title>{`${point.label}: ${full(point.value, unit)}`}</title>
              </circle>
            ))
          : null}

        {labelIndexes.map((index) => (
          <text
            key={`label-${index}`}
            x={x(index)}
            y={height - 10}
            textAnchor={
              index === 0 ? 'start' : index === data.length - 1 ? 'end' : 'middle'
            }
            className="sa-chart-axis sa-chart-axis-x"
          >
            {data[index]?.label ?? ''}
          </text>
        ))}
      </svg>

      {total === 0 ? (
        <figcaption className="sa-chart-empty">No activity in this period yet.</figcaption>
      ) : null}
    </figure>
  );
}
