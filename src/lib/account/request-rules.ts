export type RequestType = 'cancel' | 'return' | 'help';
export type RequestStatus = 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'REJECTED';
export const RETURN_WINDOW_DAYS = 7;

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
}): { ok: true } | { ok: false; error: string } {
  const status = input.fulfilmentStatus.toUpperCase();
  if (input.type === 'cancel' && (status === 'PENDING' || status === 'ACCEPTED')) return { ok: true };
  const delivered = input.deliveredAt ? new Date(input.deliveredAt) : null;
  const now = input.now || new Date();
  const returnWindow = delivered && Number.isFinite(delivered.getTime()) && now.getTime() >= delivered.getTime() && now.getTime() - delivered.getTime() <= RETURN_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  if (input.type === 'return' && status === 'DELIVERED' && returnWindow) return { ok: true };
  if (input.type === 'help') return { ok: true };
  return { ok: false, error: input.type === 'return' ? 'Returns can be requested within 7 days of delivery.' : 'Cancellation is only available before processing.' };
}
