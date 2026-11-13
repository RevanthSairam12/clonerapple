'use client';

import { SpinToWinShowcase } from '@/components/spin-wheel/SpinToWinShowcase';
import type { CustomerSpinState } from '@/lib/spin-wheel/store';

interface CustomerSpinWheelClientProps {
  initialState: CustomerSpinState;
}

export function CustomerSpinWheelClient({ initialState }: CustomerSpinWheelClientProps) {
  return <SpinToWinShowcase initialState={initialState} variant="page" />;
}
