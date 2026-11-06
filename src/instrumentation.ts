/**
 * Startup-only environment warnings (SECURITY close-out, Task 3).
 *
 * Next calls `register` once per server instance, before it serves a request.
 * A throw here would stop the server from booting, so this file does one thing:
 * read a few environment variables and log a sentence. It never opens a
 * database connection, never awaits anything, and never prints a value.
 *
 * The warning is advisory. `MAIL_ALLOWED_HOSTS` being unset does not break
 * delivery — the configured host is trusted, which is the documented behaviour
 * for a single-tenant deployment. What it means is that an owner who can edit
 * `mail_host` can point the server's SMTP password at another host, so in
 * production it should be set to the real SMTP host.
 */
import { startupWarnings } from '@/lib/platform/startup-env';

export function register(): void {
  try {
    for (const warning of startupWarnings(process.env)) {
      console.warn(`[startup] ${warning}`);
    }
  } catch {
    // A failed check must never stop the server.
  }
}
