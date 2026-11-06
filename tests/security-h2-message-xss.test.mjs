/**
 * SECURITY (H-2): a notification body is authored in store admin and stored in
 * `notification_outbox`. The customer inbox used to pass a body starting with
 * `<` to `dangerouslySetInnerHTML`, so a store admin (or anyone who could edit
 * `automated_messages`) could run script in a customer's session.
 *
 * Message bodies are text. Email is the one channel that renders HTML; there
 * the substituted values are escaped before they enter the document.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createJiti } from 'jiti';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');

const jiti = createJiti(import.meta.url, {
  alias: { '@': path.join(root, 'src') },
});

const { MessageBody } = await jiti.import(
  path.join(root, 'src', 'components', 'account', 'MessageBody.ts'),
);
const { renderEmail } = await jiti.import(
  path.join(root, 'src', 'lib', 'notifications', 'templates.ts'),
);
const { OWNER_ONLY_LIST_KINDS } = await jiti.import(
  path.join(root, 'src', 'lib', 'store-admin', 'setting-lists.ts'),
);

const PAYLOAD = '<img src=x onerror=alert(1)>';

test('a message body renders as literal text, never as markup', () => {
  const html = renderToStaticMarkup(createElement(MessageBody, { body: PAYLOAD }));

  assert.doesNotMatch(html, /<img/i);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
});

test('line breaks in a message body are preserved', () => {
  const html = renderToStaticMarkup(createElement(MessageBody, { body: 'first\nsecond' }));
  assert.match(html, /whitespace-pre-wrap/);
  assert.match(html, /first\nsecond/);
});

test('the inbox no longer uses dangerouslySetInnerHTML', async () => {
  const source = await readFile(
    path.join(root, 'src', 'components', 'account', 'MessagesManager.tsx'),
    'utf8',
  );
  assert.doesNotMatch(source, /dangerouslySetInnerHTML/);
  assert.doesNotMatch(source, /startsWith\('<'\)/);
  assert.match(source, /<MessageBody body=\{msg\.body\}/);

  // In-app copy is produced by the plain-text renderer, so what is stored is
  // text even before it reaches the component.
  const enqueue = await readFile(
    path.join(root, 'src', 'lib', 'notifications', 'enqueue.ts'),
    'utf8',
  );
  // The email branch is the only one that produces HTML; in-app and SMS copy
  // come from the plain-text renderer.
  const renderingStart = enqueue.indexOf('let subject =');
  const rendering = enqueue.slice(
    renderingStart,
    enqueue.indexOf('const recipients', renderingStart),
  );
  const nonEmail = rendering.slice(rendering.indexOf("} else if (channel === 'sms')"));
  assert.match(nonEmail, /renderText\(/);
  assert.doesNotMatch(nonEmail, /renderEmail|escapeHtml/);
});

test('email HTML escapes substituted values while the text part stays raw', () => {
  const rendered = renderEmail(
    {
      subject: 'Order {{order_number}}',
      heading: 'Hi {{customer_name}}',
      body: 'Hello {{customer_name}}, your order is ready.',
      buttonLabel: 'View order',
      buttonUrl: '{{tracking_url}}',
      footer: '',
    },
    {
      order_number: 'GZ-1',
      customer_name: '<script>alert(1)</script>',
      tracking_url: 'https://example.test/order',
    },
    'https://example.test',
  );

  assert.doesNotMatch(rendered.html, /<script>/);
  assert.match(rendered.html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  // Plain text is not HTML: it carries the value unchanged.
  assert.match(rendered.text, /<script>alert\(1\)<\/script>/);
});

test('template lists that change customer copy are owner-only', () => {
  assert.equal(OWNER_ONLY_LIST_KINDS.has('automated-messages'), true);
  assert.equal(OWNER_ONLY_LIST_KINDS.has('email-templates'), true);
  assert.equal(OWNER_ONLY_LIST_KINDS.has('fulfilment-providers'), false);
});
