import { getSql } from '@/lib/admin/db';

export interface CustomerMessageView {
  id: string;
  eventKey: string;
  subject: string;
  body: string;
  isRead: boolean;
  readAt: string | null;
  createdAt: string;
  createdDateDisplay: string;
  orderTxnid: string | null;
}

const RETENTION_ARCHIVED_TEXT = 'Message details archived according to data retention policy.';

export async function listCustomerMessages(userId: string): Promise<CustomerMessageView[]> {
  const sql = getSql();
  if (!sql) return [];

  const rows = await sql<Array<{
    id: string;
    event_key: string;
    entity_type: string;
    entity_id: string;
    subject: string;
    body: string;
    read_at: string | Date | null;
    created_at: string | Date;
  }>>`
    select
      id, event_key, entity_type, entity_id,
      subject, body, read_at, created_at
    from notification_outbox
    where customer_user_id = ${userId}
    order by created_at desc
    limit 100
  `;

  return rows.map((row) => {
    const created = new Date(row.created_at);
    const read = row.read_at ? new Date(row.read_at) : null;
    const bodyText = row.body && row.body.trim() ? row.body : RETENTION_ARCHIVED_TEXT;
    const subjectText = row.subject && row.subject.trim() ? row.subject : 'Order notification';

    return {
      id: row.id,
      eventKey: row.event_key,
      subject: subjectText,
      body: bodyText,
      isRead: Boolean(read),
      readAt: read ? read.toISOString() : null,
      createdAt: created.toISOString(),
      createdDateDisplay: created.toLocaleDateString('en-IN', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      }),
      orderTxnid: row.entity_type === 'order' ? row.entity_id : null,
    };
  });
}

export async function getUnreadMessageCount(userId: string): Promise<number> {
  const sql = getSql();
  if (!sql) return 0;

  const rows = await sql<Array<{ count: number }>>`
    select count(*)::int as count
    from notification_outbox
    where customer_user_id = ${userId}
      and read_at is null
  `;

  return rows[0]?.count ?? 0;
}

export async function markMessageRead(userId: string, messageId: string): Promise<boolean> {
  const sql = getSql();
  if (!sql) return false;

  const res = await sql`
    update notification_outbox
    set read_at = now()
    where id = ${messageId}
      and customer_user_id = ${userId}
      and read_at is null
  `;

  return res.count > 0;
}

export async function markAllMessagesRead(userId: string): Promise<number> {
  const sql = getSql();
  if (!sql) return 0;

  const res = await sql`
    update notification_outbox
    set read_at = now()
    where customer_user_id = ${userId}
      and read_at is null
  `;

  return res.count;
}
