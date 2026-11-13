'use client';

import { useEffect, useId, useState } from 'react';

import { WHEEL_POINTER_RIGHT_ANGLE_DEG } from '@/lib/spin-wheel/colors';

export interface SpinWheelSliceView {
  id: string;
  label: string;
  colorHex: string;
  textColorHex: string;
}

interface SpinWheelSvgProps {
  segments: readonly SpinWheelSliceView[];
  rotationDeg?: number;
  spinning?: boolean;
  size?: number;
  pointerAngleDeg?: number;
  ariaLabel?: string;
  className?: string;
}

function polarToCartesian(cx: number, cy: number, radius: number, angleDegFromTop: number) {
  const rad = ((angleDegFromTop - 90) * Math.PI) / 180;
  return {
    x: cx + radius * Math.cos(rad),
    y: cy + radius * Math.sin(rad),
  };
}

function describeWedge(
  cx: number,
  cy: number,
  radius: number,
  startDeg: number,
  endDeg: number,
): string {
  const start = polarToCartesian(cx, cy, radius, endDeg);
  const end = polarToCartesian(cx, cy, radius, startDeg);
  const largeArc = endDeg - startDeg <= 180 ? '0' : '1';
  return [
    `M ${cx} ${cy}`,
    `L ${start.x.toFixed(3)} ${start.y.toFixed(3)}`,
    `A ${radius} ${radius} 0 ${largeArc} 0 ${end.x.toFixed(3)} ${end.y.toFixed(3)}`,
    'Z',
  ].join(' ');
}

function splitSliceLines(label: string, maxCharsPerLine: number): string[] {
  const trimmed = label.trim().toUpperCase();
  if (!trimmed) return [''];
  if (trimmed.length <= maxCharsPerLine) return [trimmed];

  const words = trimmed.split(/\s+/);
  if (words.length === 1) {
    const mid = Math.ceil(trimmed.length / 2);
    return [trimmed.slice(0, mid), trimmed.slice(mid)];
  }

  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= maxCharsPerLine || !current) {
      current = candidate;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);

  if (lines.length > 2) {
    return [lines[0], lines.slice(1).join(' ').slice(0, maxCharsPerLine + 2)];
  }
  return lines;
}

export function SpinWheelSvg({
  segments,
  rotationDeg = 0,
  spinning = false,
  size = 420,
  pointerAngleDeg = WHEEL_POINTER_RIGHT_ANGLE_DEG,
  ariaLabel = 'Promotional prize wheel',
  className = '',
}: SpinWheelSvgProps) {
  const filterUid = useId().replace(/:/g, '');
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const apply = () => setReducedMotion(mq.matches);
    apply();
    mq.addEventListener?.('change', apply);
    return () => mq.removeEventListener?.('change', apply);
  }, []);

  const slices = segments.length >= 2
    ? segments
    : [
        { id: 'placeholder-1', label: '10% OFF', colorHex: '#f25c3b', textColorHex: '#111111' },
        { id: 'placeholder-2', label: '20% OFF', colorHex: '#e8c6ff', textColorHex: '#111111' },
        { id: 'placeholder-3', label: '5% OFF', colorHex: '#d8f561', textColorHex: '#111111' },
      ];

  const count = slices.length;
  const sliceDeg = 360 / count;
  const vb = 440;
  const cx = 220;
  const cy = 220;
  const rimOuterR = 186;
  const sliceOuterR = 171;
  const hubR = 45;
  const textR = count >= 9 ? 114 : 109;
  const fontSize = count >= 10 ? 10 : count >= 7 ? 11.5 : 12.5;
  const lineLimit = count >= 9 ? 9 : 11;

  // Rim pegs placed at every slice boundary + intermediate dots when slice count is small.
  const pegAngles: number[] = [];
  for (let i = 0; i < count; i += 1) {
    pegAngles.push(i * sliceDeg);
  }

  return (
    <div
      className={className}
      style={{
        display: 'inline-block',
        width: size,
        maxWidth: '100%',
        position: 'relative',
        userSelect: 'none',
      }}
    >
      <svg
        viewBox={`0 0 ${vb} ${vb}`}
        width="100%"
        height="100%"
        role="img"
        aria-label={ariaLabel}
        style={{ display: 'block', overflow: 'visible' }}
      >
        <defs>
          <filter id={`wheel-shadow-${filterUid}`} x="-15%" y="-15%" width="130%" height="130%">
            <feDropShadow dx="0" dy="6" stdDeviation="8" floodColor="#111111" floodOpacity="0.12" />
          </filter>
          <filter id={`hub-shadow-${filterUid}`} x="-25%" y="-25%" width="150%" height="150%">
            <feDropShadow dx="0" dy="3" stdDeviation="4" floodColor="#111111" floodOpacity="0.14" />
          </filter>
          <filter id={`pin-shadow-${filterUid}`} x="-25%" y="-25%" width="150%" height="150%">
            <feDropShadow dx="0" dy="3" stdDeviation="3.5" floodColor="#111111" floodOpacity="0.22" />
          </filter>
        </defs>

        {/* Soft ambient shadow behind entire wheel */}
        <circle
          cx={cx}
          cy={cy}
          r={rimOuterR}
          fill="#ffffff"
          filter={`url(#wheel-shadow-${filterUid})`}
        />

        {/* Rotating disc */}
        <g
          style={{
            transform: `rotate(${rotationDeg}deg)`,
            transformOrigin: `${cx}px ${cy}px`,
            transition: reducedMotion
              ? 'none'
              : spinning
                ? 'transform 4.2s cubic-bezier(0.14, 0.82, 0.16, 1)'
                : 'transform 0.35s ease-out',
          }}
        >
          {/* White outer bezel ring */}
          <circle cx={cx} cy={cy} r={rimOuterR} fill="#ffffff" stroke="#e4dfd4" strokeWidth={2} />

          {/* Colored pie segments */}
          {slices.map((seg, idx) => {
            const start = idx * sliceDeg;
            const end = (idx + 1) * sliceDeg;
            const mid = start + sliceDeg / 2;
            const pos = polarToCartesian(cx, cy, textR, mid);
            const lines = splitSliceLines(seg.label, lineLimit);
            // Keep label readable along the wedge radius toward outer rim.
            const normalizedMid = ((mid % 360) + 360) % 360;
            const flipReading = normalizedMid > 180;
            const labelAngle = flipReading ? mid + 90 : mid - 90;

            return (
              <g key={`${seg.id}-${idx}`}>
                <path
                  d={describeWedge(cx, cy, sliceOuterR, start, end)}
                  fill={seg.colorHex}
                  stroke="rgba(255,255,255,0.28)"
                  strokeWidth={1}
                />
                <text
                  x={pos.x}
                  y={pos.y}
                  fill={seg.textColorHex || '#141414'}
                  fontSize={fontSize}
                  fontWeight={700}
                  letterSpacing="0.02em"
                  textAnchor="middle"
                  dominantBaseline="central"
                  transform={`rotate(${labelAngle}, ${pos.x}, ${pos.y})`}
                >
                  {lines.map((line, lineIdx) => {
                    const dy =
                      lines.length === 1
                        ? 0
                        : lineIdx === 0
                          ? -(fontSize * 0.56)
                          : fontSize * 1.15;
                    return (
                      <tspan key={lineIdx} x={pos.x} dy={dy}>
                        {line}
                      </tspan>
                    );
                  })}
                </text>
              </g>
            );
          })}

          {/* Inner rim edge subtle divider */}
          <circle
            cx={cx}
            cy={cy}
            r={sliceOuterR}
            fill="none"
            stroke="rgba(17, 17, 17, 0.06)"
            strokeWidth={1.5}
          />

          {/* Metallic grey rim studs at slice boundaries */}
          {pegAngles.map((deg, idx) => {
            const pegPos = polarToCartesian(cx, cy, (rimOuterR + sliceOuterR) / 2, deg);
            return (
              <circle
                key={`peg-${idx}`}
                cx={pegPos.x}
                cy={pegPos.y}
                r={3.5}
                fill="#9b9891"
                stroke="#ffffff"
                strokeWidth={0.8}
              />
            );
          })}
        </g>

        {/* Stationary elevated matte-white center hub */}
        <circle
          cx={cx}
          cy={cy}
          r={hubR}
          fill="#ffffff"
          stroke="#efece4"
          strokeWidth={1.5}
          filter={`url(#hub-shadow-${filterUid})`}
        />

        {/* Stationary black teardrop pointer with inner white circle at pointerAngleDeg */}
        <g
          transform={`rotate(${pointerAngleDeg}, ${cx}, ${cy})`}
          filter={`url(#pin-shadow-${filterUid})`}
        >
          <path
            d={[
              `M ${cx} ${cy - sliceOuterR + 8}`,
              `C ${cx - 17} ${cy - sliceOuterR - 11}, ${cx - 21} ${cy - rimOuterR - 14}, ${cx - 17} ${cy - rimOuterR - 25}`,
              `A 18.5 18.5 0 1 1 ${cx + 17} ${cy - rimOuterR - 25}`,
              `C ${cx + 21} ${cy - rimOuterR - 14}, ${cx + 17} ${cy - sliceOuterR - 11}, ${cx} ${cy - sliceOuterR + 8}`,
              'Z',
            ].join(' ')}
            fill="#0d0d0d"
          />
          <circle cx={cx} cy={cy - rimOuterR - 20} r={5.4} fill="#ffffff" />
        </g>
      </svg>
    </div>
  );
}
