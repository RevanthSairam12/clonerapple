/**
 * Pure fulfilment automation for a payment that has just been verified paid.
 *
 * Store Admin → Order settings decides the target, but the order still has to
 * walk the legal transitions in `order-rules.ts` one step at a time. Nothing
 * here skips a status: an illegal or unreachable target simply produces fewer
 * steps, and a cancelled or delivered order produces none.
 */

import { FULFILMENT_TRANSITIONS, type FulfilmentStatus } from '@/lib/store-admin/order-rules';

/** Forward fulfilment chain. CANCELED is terminal and deliberately absent. */
const FORWARD_CHAIN: readonly FulfilmentStatus[] = [
  'PENDING',
  'ACCEPTED',
  'PROCESSING',
  'ON_THE_WAY',
  'DELIVERED',
];

export function isFulfilmentStatus(value: unknown): value is FulfilmentStatus {
  return (
    value === 'PENDING' ||
    value === 'ACCEPTED' ||
    value === 'PROCESSING' ||
    value === 'ON_THE_WAY' ||
    value === 'DELIVERED' ||
    value === 'CANCELED'
  );
}

export function fulfilmentRank(status: FulfilmentStatus): number {
  return FORWARD_CHAIN.indexOf(status);
}

export interface FulfilmentAutomationInput {
  /** Orders → "Auto-confirm paid orders". */
  autoConfirm: boolean;
  /** Orders → "Default fulfilment status". */
  defaultStatus: unknown;
}

/**
 * Target status after a verified payment. Auto-confirm lifts the target to at
 * least ACCEPTED; the default can move it further along the chain.
 */
export function resolveFulfilmentTarget(input: FulfilmentAutomationInput): FulfilmentStatus {
  const configured = isFulfilmentStatus(input.defaultStatus) ? input.defaultStatus : 'PENDING';
  let target: FulfilmentStatus = configured === 'CANCELED' ? 'PENDING' : configured;
  if (input.autoConfirm && fulfilmentRank(target) < fulfilmentRank('ACCEPTED')) target = 'ACCEPTED';
  return target;
}

/**
 * Ordered list of statuses to apply. Empty when the order is already at or
 * past the target, is cancelled, or the target is unreachable.
 */
export function planFulfilmentAutomation(
  fromStatus: unknown,
  input: FulfilmentAutomationInput,
): FulfilmentStatus[] {
  if (!isFulfilmentStatus(fromStatus)) return [];
  const startIndex = FORWARD_CHAIN.indexOf(fromStatus);
  if (startIndex < 0) return []; // CANCELED
  const target = resolveFulfilmentTarget(input);
  const targetIndex = FORWARD_CHAIN.indexOf(target);
  if (targetIndex <= startIndex) return [];

  const steps: FulfilmentStatus[] = [];
  let current: FulfilmentStatus = fromStatus;
  for (let index = startIndex + 1; index <= targetIndex; index += 1) {
    const next = FORWARD_CHAIN[index];
    if (!FULFILMENT_TRANSITIONS[current].includes(next)) break;
    steps.push(next);
    current = next;
  }
  return steps;
}
