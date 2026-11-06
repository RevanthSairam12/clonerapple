import { createElement } from 'react';

/**
 * A stored notification body is text, never markup.
 *
 * Store admin authors the copy in `automated_messages`; the customer inbox
 * renders exactly what was stored. React escapes text children, so a body
 * such as `<img src=x onerror=alert(1)>` appears literally instead of
 * executing. Line breaks are preserved by `whitespace-pre-wrap`.
 */
export function MessageBody({ body }: { body: string }) {
  return createElement(
    'div',
    { className: 'text-[#1d1d1f] whitespace-pre-wrap leading-relaxed' },
    body,
  );
}
