import { getStoreSettings } from '@/lib/store-admin/settings';

import { parseReturnWindowDays, RETURN_WINDOW_DAYS } from './request-rules';

/**
 * Return window in days, from Store Admin → Orders → Return window.
 *
 * Unset, invalid or unavailable settings keep the historical seven days, so
 * return eligibility never widens or narrows by accident when the settings
 * read fails.
 */
if (typeof window !== 'undefined') {
  throw new Error('SECURITY ALERT: Return window settings must be read on the server only.');
}

export async function readReturnWindowDays(): Promise<number> {
  try {
    const result = await getStoreSettings();
    if (!result.ok) return RETURN_WINDOW_DAYS;
    return parseReturnWindowDays(result.settings.return_window_days);
  } catch {
    return RETURN_WINDOW_DAYS;
  }
}
