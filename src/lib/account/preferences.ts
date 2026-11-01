import { randomBytes } from 'crypto';
import { getSql } from '@/lib/platform/db';
import { normalizeEmail } from '@/lib/coupons/rules';

export async function getCommunicationPreferences(userId: string): Promise<{
  marketingOptIn: boolean;
  email: string;
}> {
  const sql = getSql();
  if (!sql) return { marketingOptIn: false, email: '' };

  const rows = await sql<Array<{ marketing_opt_in: boolean; email: string }>>`
    select marketing_opt_in, email
    from users
    where id = ${userId}
    limit 1
  `;

  return {
    marketingOptIn: rows[0]?.marketing_opt_in ?? false,
    email: rows[0]?.email ?? '',
  };
}

export async function updateCommunicationPreferences(
  userId: string,
  marketingOptIn: boolean,
): Promise<boolean> {
  const sql = getSql();
  if (!sql) return false;

  const rows = await sql<Array<{ email: string }>>`
    select email from users where id = ${userId} limit 1
  `;
  if (!rows[0]) return false;

  const email = normalizeEmail(rows[0].email);

  await sql.begin(async (tx) => {
    await tx`
      update users
      set marketing_opt_in = ${marketingOptIn}, updated_at = now()
      where id = ${userId}
    `;

    if (marketingOptIn) {
      const subRows = await tx<Array<{ id: string }>>`
        select id from newsletter_subscribers where email = ${email} limit 1
      `;
      if (subRows[0]) {
        await tx`
          update newsletter_subscribers
          set unsubscribed_at = null,
              unsubscribe_reason = '',
              updated_at = now()
          where email = ${email}
        `;
      } else {
        const id = `sub_${randomBytes(12).toString('hex')}`;
        await tx`
          insert into newsletter_subscribers (
            id, email, source, consent_at, subscribed_at, created_at, updated_at
          ) values (
            ${id}, ${email}, 'storefront', now(), now(), now(), now()
          )
          on conflict (email) do update set
            unsubscribed_at = null,
            unsubscribe_reason = '',
            updated_at = now()
        `;
      }
    } else {
      await tx`
        update newsletter_subscribers
        set unsubscribed_at = now(),
            unsubscribe_reason = 'Customer communication preferences',
            updated_at = now()
        where email = ${email} and unsubscribed_at is null
      `;
    }
  });

  return true;
}
