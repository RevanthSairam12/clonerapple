export type RequestType = 'cancel' | 'return' | 'help';
export type RequestStatus = 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'REJECTED';

/** Default return window, also used when the setting is empty. */
export const RETURN_WINDOW_DAYS = 7;
export const DEFAULT_RETURN_WINDOW_DAYS = RETURN_WINDOW_DAYS;

/**
 * Whole days from `return_window_days`. Empty or invalid input keeps the
 * default so an unset setting never closes returns.
 */
export function parseReturnWindowDays(value: unknown): number {
  const parsed = Number(String(value ?? '').trim());
  if (!Number.isFinite(parsed)) return RETURN_WINDOW_DAYS;
  const days = Math.trunc(parsed);
  if (days < 1) return RETURN_WINDOW_DAYS;
  return Math.min(365, days);
}

export const REQUEST_TRANSITIONS: Readonly<Record<RequestStatus, readonly RequestStatus[]>> = {
  OPEN: ['IN_PROGRESS', 'RESOLVED', 'REJECTED'],
  IN_PROGRESS: ['OPEN', 'RESOLVED', 'REJECTED'],
  RESOLVED: [],
  REJECTED: [],
};

export function canTransitionRequest(from: RequestStatus, to: RequestStatus): boolean {
  return REQUEST_TRANSITIONS[from].includes(to);
}

export function validateRequestType(type: unknown): type is RequestType {
  return type === 'cancel' || type === 'return' || type === 'help';
}

export function validateCustomerRequestState(input: {
  type: RequestType;
  fulfilmentStatus: string;
  deliveredAt?: Date | string | null;
  now?: Date;
  /** Store Admin → Orders → Return window, in days. Defaults to 7. */
  returnWindowDays?: number;
}): { ok: true } | { ok: false; error: string } {
  const status = input.fulfilmentStatus.toUpperCase();
  if (input.type === 'cancel' && (status === 'PENDING' || status === 'ACCEPTED')) return { ok: true };
  const delivered = input.deliveredAt ? new Date(input.deliveredAt) : null;
  const now = input.now || new Date();
  const windowDays = parseReturnWindowDays(input.returnWindowDays);
  const returnWindow = delivered && Number.isFinite(delivered.getTime()) && now.getTime() >= delivered.getTime() && now.getTime() - delivered.getTime() <= windowDays * 24 * 60 * 60 * 1000;
  if (input.type === 'return' && status === 'DELIVERED' && returnWindow) return { ok: true };
  if (input.type === 'help') return { ok: true };
  const returnError = `Returns can be requested within ${windowDays} day${windowDays === 1 ? '' : 's'} of delivery.`;
  return { ok: false, error: input.type === 'return' ? returnError : 'Cancellation is only available before processing.' };
}
