'use client';

import { useEffect, useState } from 'react';

import { contrastTextForHex, sanitizeHexColor } from '@/lib/spin-wheel/colors';

export interface SpinWheelSliceView {
  id: string;
  label: string;
  colorHex: string;
  textColorHex?: string;
}

interface SpinWheelSvgProps {
  segments: readonly SpinWheelSliceView[];
  rotationDeg?: number;
  spinning?: boolean;
  size?: number;
  ariaLabel?: string;
}

function polarToCartesian(cx: number, cy: number, radius: number, angleDegClockwiseFromTop: number) {
  const rad = ((angleDegClockwiseFromTop - 90) * Math.PI) / 180;
  return {
    x: cx + radius * Math.cos(rad),
    y: cy + radius * Math.sin(rad),
  };
}

function wedgePath(cx: number, cy: number, radius: number, startDeg: number, endDeg: number): string {
  const start = polarToCartesian(cx, cy, radius, endDeg);
  const end = polarToCartesian(cx, cy, radius, startDeg);
  const largeArcFlag = endDeg - startDeg <= 180 ? '0' : '1';
  return [
    'M',
    cx,
    cy,
    'L',
    start.x.toFixed(2),
    start.y.toFixed(2),
    'A',
    radius,
    radius,
    0,
    largeArcFlag,
    0,
    end.x.toFixed(2),
    end.y.toFixed(2),
    'Z',
  ].join(' ');
}

function truncateLabel(label: string, totalSegments: number): string {
  const maxChars = totalSegments >= 10 ? 12 : totalSegments >= 7 ? 14 : 16;
  const trimmed = label.trim() || 'Prize';
  if (trimmed.length <= maxChars) return trimmed;
  return `${trimmed.slice(0, maxChars - 1)}…`;
}

export function SpinWheelSvg({
  segments,
  rotationDeg = 0,
  spinning = false,
  size = 320,
  ariaLabel = 'Prize wheel',
}: SpinWheelSvgProps) {
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => setReducedMotion(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);

  const slices = segments.length > 0
    ? segments
    : [
        { id: 'empty-1', label: 'Prize 1', colorHex: '#ffe100' },
        { id: 'empty-2', label: 'Try again', colorHex: '#111111' },
      ];

  const count = slices.length;
  const sliceDeg = 360 / count;
  const cx = 180;
  const cy = 190;
  const outerR = 160;
  const textR = count >= 9 ? 98 : 88;
  const fontSize = count >= 10 ? 9.5 : count >= 7 ? 10.5 : 11.5;

  return (
    <div
      style={{
        width: '100%',
        maxWidth: `${size}px`,
        margin: '0 auto',
        position: 'relative',
      }}
    >
      <svg
        viewBox="0 0 360 370"
        width="100%"
        height="auto"
        role="img"
        aria-label={ariaLabel}
        style={{ display: 'block', overflow: 'visible' }}
      >
        {/* Outer rim shadow */}
        <circle cx={cx} cy={cy} r={outerR + 8} fill="#111111" />
        <circle cx={cx} cy={cy} r={outerR + 3} fill="#ffffff" />

        {/* Rotating wheel group */}
        <g
          style={{
            transform: `rotate(${rotationDeg}deg)`,
            transformOrigin: `${cx}px ${cy}px`,
            transition: reducedMotion
              ? 'none'
              : spinning
                ? 'transform 4.2s cubic-bezier(0.14, 0.85, 0.22, 1)'
                : 'transform 0.5s ease-out',
          }}
        >
          {slices.map((slice, index) => {
            const startDeg = index * sliceDeg;
            const endDeg = (index + 1) * sliceDeg;
            const midDeg = startDeg + sliceDeg / 2;
            const bg = sanitizeHexColor(slice.colorHex, '#ffe100');
            const fg = slice.textColorHex || contrastTextForHex(bg);
            const labelPoint = polarToCartesian(cx, cy, textR, midDeg);
            const textAngle = midDeg - 90;

            return (
              <g key={slice.id}>
                <path
                  d={wedgePath(cx, cy, outerR, startDeg, endDeg)}
                  fill={bg}
                  stroke="#ffffff"
                  strokeWidth={2}
                />
                <text
                  x={labelPoint.x}
                  y={labelPoint.y}
                  fill={fg}
                  fontSize={fontSize}
                  fontWeight={700}
                  textAnchor="middle"
                  dominantBaseline="central"
                  transform={`rotate(${textAngle.toFixed(2)}, ${labelPoint.x.toFixed(2)}, ${labelPoint.y.toFixed(2)})`}
                  style={{ pointerEvents: 'none', userSelect: 'none' }}
                >
                  {truncateLabel(slice.label, count)}
                </text>
              </g>
            );
          })}
          {/* Center cap */}
          <circle cx={cx} cy={cy} r={24} fill="#111111" stroke="#ffffff" strokeWidth={4} />
          <circle cx={cx} cy={cy} r={8} fill="#ffe100" />
        </g>

        {/* Top 12 o'clock pointer */}
        <polygon
          points={`${cx - 15},10 ${cx + 15},10 ${cx},42`}
          fill="#111111"
          stroke="#ffffff"
          strokeWidth={3}
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}

