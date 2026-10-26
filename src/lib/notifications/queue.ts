import { after } from 'next/server';

import { enqueueNotification } from './enqueue';
import { processNotificationOutbox } from './outbox';
import type {
  NotificationContext,
  NotificationEntity,
  NotificationEvent,
} from './types';

/**
 * Fire-and-forget notification enqueue.
 *
 * Business code calls this after its transaction commits and never awaits it.
 * On a Next.js request the work is handed to `after()`, which runs once the
 * response is finished; outside a request (a script or a test) it starts in the
 * background directly. Either way a slow SMTP server or a broken settings row
 * cannot delay or fail checkout, a callback or a staff action.
 *
 * The immediate drain is best-effort. The reconcile cron is the durable
 * retry path, so skipping the drain only delays a message, never loses it.
 */
export function queueNotification(
  event: NotificationEvent,
  entity: NotificationEntity,
  context: NotificationContext = {},
): void {
  const run = async (): Promise<void> => {
    const result = await enqueueNotification(event, entity, context);
    if (result.ok && result.queued > 0) {
      await processNotificationOutbox(Math.min(20, result.queued));
    }
  };

  try {
    after(async () => {
      await run().catch(() => {});
    });
  } catch {
    void run().catch(() => {});
  }
}
