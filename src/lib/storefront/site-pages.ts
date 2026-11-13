import { getSql } from '@/lib/platform/db';

if (typeof window !== 'undefined') {
  throw new Error('SECURITY ALERT: Site page readers must run on the server only.');
}

export interface StorePageRecord {
  slug: string;
  title: string;
  body: string;
  seoTitle: string;
  seoDescription: string;
  status: 'draft' | 'published';
  updatedAt: string | null;
}

export interface BusinessContactSettings {
  tradeName: string;
  legalName: string;
  email: string;
  phone: string;
  address: string;
  footerText: string;
  cookieNotice: string;
}

export interface SeoPageRecord {
  pageKey: string;
  metaTitle: string;
  metaDescription: string;
  robotsIndex: boolean;
  robotsFollow: boolean;
}

const DEFAULT_CONTACT: BusinessContactSettings = {
  tradeName: 'Gadzio',
  legalName: 'RUPEEDO TECHNOLOGIES',
  email: 'support@gadzio.co.in',
  phone: '+916304859367',
  address: 'SAI NIVAS, MOGALTUR, MASJID STREET, MOGALTHUR, AP, WESTGODAVARI, 534281',
  footerText: '',
  cookieNotice: '',
};

function clean(value: unknown, fallback = ''): string {
  const str = value === null || value === undefined ? '' : String(value).trim();
  return str || fallback;
}

function formatUpdatedDate(value: unknown): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString('en-IN', {
    month: 'long',
    year: 'numeric',
    timeZone: 'Asia/Kolkata',
  });
}

/**
 * Read a published store page (`privacy`, `terms`, `support`, etc.) and the
 * store's public support contact details from `store_pages` and `store_settings`.
 *
 * Graceful fallback: if the database is unreachable, or the page is still in
 * `draft` status or has an empty body, `page` is null so the route renders its
 * existing built-in copy unchanged.
 */
export async function readStorePageAndContact(slug: string): Promise<{
  page: StorePageRecord | null;
  contact: BusinessContactSettings;
}> {
  const sql = getSql();
  if (!sql) {
    return { page: null, contact: DEFAULT_CONTACT };
  }

  try {
    const [pageRows, settingRows] = await Promise.all([
      sql<
        Array<{
          slug: string;
          title: string;
          body: string;
          seo_title: string | null;
          seo_description: string | null;
          status: string;
          updated_at: Date | string | null;
        }>
      >`
        select slug, title, body, seo_title, seo_description, status, updated_at
        from store_pages
        where slug = ${slug.trim().toLowerCase()}
        limit 1
      `,
      sql<Array<{ key: string; value: string }>>`
        select key, value
        from store_settings
        where key in ('trade_name', 'legal_name', 'email', 'phone', 'address', 'footer_text', 'cookie_notice')
      `,
    ]);

    const byKey = new Map(settingRows.map((r) => [String(r.key), String(r.value ?? '')]));
    const contact: BusinessContactSettings = {
      tradeName: clean(byKey.get('trade_name'), DEFAULT_CONTACT.tradeName),
      legalName: clean(byKey.get('legal_name'), DEFAULT_CONTACT.legalName),
      email: clean(byKey.get('email'), DEFAULT_CONTACT.email),
      phone: clean(byKey.get('phone'), DEFAULT_CONTACT.phone),
      address: clean(byKey.get('address'), DEFAULT_CONTACT.address),
      footerText: clean(byKey.get('footer_text'), DEFAULT_CONTACT.footerText),
      cookieNotice: clean(byKey.get('cookie_notice'), DEFAULT_CONTACT.cookieNotice),
    };

    const row = pageRows[0];
    if (!row || String(row.status).toLowerCase() !== 'published' || !clean(row.body)) {
      return { page: null, contact };
    }

    return {
      page: {
        slug: clean(row.slug),
        title: clean(row.title),
        body: clean(row.body),
        seoTitle: clean(row.seo_title),
        seoDescription: clean(row.seo_description),
        status: 'published',
        updatedAt: formatUpdatedDate(row.updated_at),
      },
      contact,
    };
  } catch {
    return { page: null, contact: DEFAULT_CONTACT };
  }
}

/**
 * Read optional `seo_pages` override row by `page_key` (`home`, `search`, `privacy`, `terms`, `support`, etc.).
 * Returns null if unset or database is unreachable so existing metadata defaults apply.
 */
export async function readSeoPageOverride(pageKey: string): Promise<SeoPageRecord | null> {
  const sql = getSql();
  if (!sql) return null;
  try {
    const rows = await sql<
      Array<{
        page_key: string;
        meta_title: string | null;
        meta_description: string | null;
        robots_index: boolean | string | null;
        robots_follow: boolean | string | null;
      }>
    >`
      select page_key, meta_title, meta_description, robots_index, robots_follow
      from seo_pages
      where page_key = ${pageKey.trim().toLowerCase()}
      limit 1
    `;
    const row = rows[0];
    if (!row) return null;
    const metaTitle = clean(row.meta_title);
    const metaDescription = clean(row.meta_description);
    if (!metaTitle && !metaDescription) return null;
    return {
      pageKey: clean(row.page_key, pageKey),
      metaTitle,
      metaDescription,
      robotsIndex: row.robots_index !== false && row.robots_index !== 'off',
      robotsFollow: row.robots_follow !== false && row.robots_follow !== 'off',
    };
  } catch {
    return null;
  }
}

/**
 * Split plain-text / Markdown paragraphs safely into sections without raw HTML
 * injection (`dangerouslySetInnerHTML` is never used).
 */
export function parseSafePageParagraphs(body: string): Array<{ heading?: string; paragraphs: string[] }> {
  const lines = String(body ?? '').split(/\r?\n/);
  const sections: Array<{ heading?: string; paragraphs: string[] }> = [];
  let current: { heading?: string; paragraphs: string[] } = { paragraphs: [] };
  let buffer: string[] = [];

  const flushParagraph = () => {
    if (buffer.length > 0) {
      current.paragraphs.push(buffer.join(' ').trim());
      buffer = [];
    }
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      flushParagraph();
      continue;
    }
    const headingMatch = /^#{1,3}\s+(.+)$/.exec(line);
    if (headingMatch) {
      flushParagraph();
      if (current.heading || current.paragraphs.length > 0) {
        sections.push(current);
      }
      current = { heading: headingMatch[1].trim(), paragraphs: [] };
      continue;
    }
    buffer.push(line);
  }

  flushParagraph();
  if (current.heading || current.paragraphs.length > 0) {
    sections.push(current);
  }

  return sections;
}
