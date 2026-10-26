import test from 'node:test';
import assert from 'node:assert/strict';

import {
  defaultTemplate,
  renderEmail,
  renderText,
  safeEmailLink,
  safeHttpsUrl,
  substitute,
  templateValues,
} from '../src/lib/notifications/templates.ts';
import { NOTIFICATION_EVENTS } from '../src/lib/notifications/types.ts';

const AUDIENCES = ['customer', 'staff'];
const CHANNELS = ['email', 'sms', 'inapp'];

function valuesFor(audience, overrides = {}) {
  return {
    audience,
    txnid: 'GDZ1001',
    customerName: 'Ravi Kumar',
    orderTotalPaise: 123400,
    shippingPaise: 4900,
    refundPaise: 123400,
    orderStatus: 'ON_THE_WAY',
    trackingNumber: 'AWB123',
    trackingLink: 'https://track.example.test/AWB123',
    itemCount: 2,
    productName: 'Case',
    stockAvailable: 3,
    storeName: 'Gadzio',
    supportPhone: '9876543210',
    supportEmail: 'support@example.test',
    returnWindowDays: 7,
    adminLink: '/store-admin/orders/GDZ1001',
    ...overrides,
  };
}

function values(overrides = {}) {
  return templateValues(valuesFor('customer', overrides));
}

test('every event, channel and audience has a non-empty default', () => {
  for (const event of NOTIFICATION_EVENTS) {
    for (const channel of CHANNELS) {
      for (const audience of AUDIENCES) {
        const parts = defaultTemplate(event, channel, audience);
        assert.ok(parts.subject.trim(), `${event}/${channel}/${audience} needs a subject`);
        assert.ok(parts.body.trim(), `${event}/${channel}/${audience} needs a body`);

        const rendered = channel === 'email'
          ? renderEmail(parts, templateValues(valuesFor(audience)), 'https://shop.example.test')
          : {
              subject: renderText(parts.subject, templateValues(valuesFor(audience)), true),
              text: renderText(parts.body, templateValues(valuesFor(audience)), true),
              html: '',
            };
        assert.ok(rendered.subject.trim(), `${event}/${channel}/${audience} subject lost its content`);
        assert.ok(rendered.text.trim(), `${event}/${channel}/${audience} body lost its content`);
        assert.doesNotMatch(rendered.subject, /\{\{/, `${event}/${channel}/${audience} left a token in the subject`);
        assert.doesNotMatch(rendered.text, /\{\{/, `${event}/${channel}/${audience} left a token in the body`);
      }
    }
  }
});

test('a script tag in a customer name is escaped in email and never executes', () => {
  const parts = defaultTemplate('order_placed', 'email', 'customer');
  const rendered = renderEmail(
    parts,
    values({ customerName: '<script>alert(1)</script>' }),
    'https://shop.example.test',
  );

  assert.match(rendered.html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(rendered.html, /<script>alert/);
  // The plain-text alternative is not markup, so the angle brackets may stay.
  assert.match(rendered.text, /<script>alert\(1\)<\/script>/);
});

test('a stored template body is treated as text, so markup cannot be injected', () => {
  const rendered = renderEmail(
    {
      subject: 'Hello',
      heading: 'Hi <b>there</b>',
      body: 'Line one <img src=x onerror=alert(1)>\nLine two',
      buttonLabel: '',
      buttonUrl: '',
      footer: '',
    },
    values(),
    'https://shop.example.test',
  );

  assert.match(rendered.html, /Line one &lt;img src=x onerror=alert\(1\)&gt;<br>Line two/);
  assert.doesNotMatch(rendered.html, /<img src=x/);
  assert.match(rendered.html, /Hi &lt;b&gt;there&lt;\/b&gt;/);
});

test('unknown variables render empty and never read from the object', () => {
  const rendered = substitute(
    '{{order_number}}|{{secret}}|{{constructor}}|{{__proto__}}|{{toString}}|{{unknown_name}}',
    values(),
  );
  assert.equal(rendered, 'GDZ1001|||||');
});

test('the documented template aliases resolve', () => {
  const rendered = substitute(
    '{{order_id}}/{{total}}/{{tracking_url}}/{{refund_amount}}/{{store_name}}',
    values(),
  );
  assert.equal(rendered, 'GDZ1001/₹1,234.00/https://track.example.test/AWB123/₹1,234.00/Gadzio');
});

test('a newline in a value cannot inject a mail header', () => {
  const subject = renderText(
    'Order {{order_number}}',
    values({ txnid: 'GDZ1001\r\nBcc: attacker@example.test' }),
    true,
  );
  assert.equal(subject, 'Order GDZ1001 Bcc: attacker@example.test');
  assert.doesNotMatch(subject, /[\r\n]/);
});

test('SMS values are flattened and control characters removed', () => {
  const body = renderText(
    'Hi {{customer_name}} — your order {{order_number}}',
    values({ customerName: 'Ravi\n\tKumar\u0007', txnid: 'GDZ1001' }),
    true,
  );
  assert.equal(body, 'Hi Ravi Kumar — your order GDZ1001');
  assert.doesNotMatch(body, /[\u0000-\u001F\u007F]/);
});

test('customer messages carry the name; staff messages do not', () => {
  const customer = templateValues(valuesFor('customer'));
  const staff = templateValues(valuesFor('staff'));
  assert.equal(customer.customer_name, 'Ravi Kumar');
  assert.equal(staff.customer_name, '', 'staff messages never receive the customer name');
});

test('only https tracking links survive', () => {
  assert.equal(safeHttpsUrl('https://track.example.test/AWB123'), 'https://track.example.test/AWB123');
  assert.equal(safeHttpsUrl('http://track.example.test/AWB123'), '');
  assert.equal(safeHttpsUrl('javascript:alert(1)'), '');
  assert.equal(safeHttpsUrl('https://user:pass@track.example.test/AWB123'), '');
  assert.equal(
    templateValues(valuesFor('customer', { trackingLink: 'http://x.test' })).tracking_link,
    '',
  );
});

test('relative admin paths become absolute email links; bad schemes are rejected', () => {
  assert.equal(
    safeEmailLink('/store-admin/orders/GDZ1001', 'https://shop.example.test/'),
    'https://shop.example.test/store-admin/orders/GDZ1001',
  );
  assert.equal(safeEmailLink('//evil.example.test/x', 'https://shop.example.test'), '');
  assert.equal(safeEmailLink('javascript:alert(1)', 'https://shop.example.test'), '');
  assert.equal(safeEmailLink('http://track.example.test/x', 'https://shop.example.test'), '');
});

test('an empty customer name still reads naturally', () => {
  const customer = templateValues({ audience: 'customer', txnid: 'GDZ1002' });
  assert.equal(customer.customer_name, 'there');
});

test('shipping, refund, status and count values are formatted for messages', () => {
  const v = templateValues(valuesFor('customer'));
  assert.equal(v.shipping_amount, '₹49.00');
  assert.equal(v.refund_amount, '₹1,234.00');
  assert.equal(v.order_status, 'on the way');
  assert.equal(v.item_count, '2');
  assert.equal(v.stock_available, '3');
  assert.equal(v.order_number, 'GDZ1001');
  assert.equal(v.txnid, 'GDZ1001');
});
