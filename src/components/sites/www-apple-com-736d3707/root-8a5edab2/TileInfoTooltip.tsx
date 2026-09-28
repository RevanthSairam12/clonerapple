'use client';

import { useEffect, useRef, useState } from 'react';

import { cn } from '@/lib/utils';

export function TileInfoTooltip({ text }: { text: string }) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;

    const handleOutsideClick = (e: MouseEvent | TouchEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsOpen(false);
    };

    document.addEventListener('mousedown', handleOutsideClick);
    document.addEventListener('touchstart', handleOutsideClick);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
      document.removeEventListener('touchstart', handleOutsideClick);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  if (!text) return null;

  return (
    <div
      ref={containerRef}
      className="group/tooltip absolute -bottom-[3px] -right-[3px] z-10 inline-flex items-center justify-center select-none"
      onMouseEnter={() => setIsOpen(true)}
      onMouseLeave={() => setIsOpen(false)}
    >
      <button
        type="button"
        aria-label="Student discount eligibility information"
        aria-expanded={isOpen}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setIsOpen((prev) => !prev);
        }}
        className={cn(
          'flex size-[10px] items-center justify-center rounded-full',
          'bg-white/90 text-[#0071e3] border border-[#0071e3]/30 shadow-sm cursor-pointer',
          'transition-all duration-200',
          'group-hover/tooltip:scale-125 group-hover/tooltip:bg-[#0071e3] group-hover/tooltip:text-white group-hover/tooltip:border-white/60',
          'focus:outline-none focus:ring-1 focus:ring-[#0071e3]/50',
          isOpen && 'scale-125 bg-[#0071e3] text-white border-white/60',
        )}
      >
        <span
          className={cn(
            'font-serif italic text-[7px] font-bold leading-none -translate-y-[0.3px] transition-colors',
            'text-[#0071e3] group-hover/tooltip:text-white',
            isOpen && 'text-white',
          )}
        >
          i
        </span>
      </button>

      {/* Tooltip Card */}
      <div
        role="tooltip"
        className={cn(
          'absolute bottom-[calc(100%+6px)] right-0 z-30',
          'w-max max-w-[300px] sm:max-w-[340px] rounded-xl px-4 py-3',
          'bg-[#1d1d1f]/97 text-[#f5f5f7] backdrop-blur-xl border border-white/20 shadow-2xl',
          'text-left text-[13px] leading-[1.5] font-normal tracking-[-0.01em]',
          'transition-all duration-200 ease-out origin-bottom-right',
          isOpen
            ? 'opacity-100 visible scale-100 pointer-events-auto translate-y-0'
            : 'opacity-0 invisible scale-95 pointer-events-none translate-y-1 group-hover/tooltip:opacity-100 group-hover/tooltip:visible group-hover/tooltip:scale-100 group-hover/tooltip:pointer-events-auto group-hover/tooltip:translate-y-0 group-focus-within/tooltip:opacity-100 group-focus-within/tooltip:visible group-focus-within/tooltip:scale-100 group-focus-within/tooltip:pointer-events-auto group-focus-within/tooltip:translate-y-0',
        )}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Caret arrow pointing down */}
        <div className="absolute -bottom-[5px] right-1.5 size-2.5 rotate-45 bg-[#1d1d1f] border-b border-r border-white/20" />
        <p className="relative z-1">{text}</p>
      </div>
    </div>
  );
}
