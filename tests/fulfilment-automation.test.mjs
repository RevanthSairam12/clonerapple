import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createJiti } from 'jiti';

const here = path.dirname(fileURLToPath(import.meta.url));
const jiti = createJiti(import.meta.url, {
  moduleCache: false,
  alias: { '@': path.join(here, '..', 'src') },
});

const {
  planFulfilmentAutomation,
  resolveFulfilmentTarget,
} = await jiti.import(
  path.join(here, '..', 'src', 'lib', 'orders', 'fulfilment-automation.ts'),
);
const { FULFILMENT_TRANSITIONS } = await jiti.import(
  path.join(here, '..', 'src', 'lib', 'store-admin', 'order-rules.ts'),
);

test('auto-confirm lifts a paid order to ACCEPTED', () => {
  assert.deepEqual(
    planFulfilmentAutomation('PENDING', { autoConfirm: true, defaultStatus: 'PENDING' }),
    ['ACCEPTED'],
  );
});

test('with auto-confirm off and the default pending, nothing moves', () => {
  assert.deepEqual(
    planFulfilmentAutomation('PENDING', { autoConfirm: false, defaultStatus: 'PENDING' }),
    [],
  );
});

test('the configured default walks the chain step by step', () => {
  assert.deepEqual(
    planFulfilmentAutomation('PENDING', { autoConfirm: false, defaultStatus: 'PROCESSING' }),
    ['ACCEPTED', 'PROCESSING'],
  );
  assert.deepEqual(
    planFulfilmentAutomation('PENDING', { autoConfirm: true, defaultStatus: 'ON_THE_WAY' }),
    ['ACCEPTED', 'PROCESSING', 'ON_THE_WAY'],
  );
});

test('a target at or behind the current status changes nothing', () => {
  assert.deepEqual(
    planFulfilmentAutomation('PROCESSING', { autoConfirm: true, defaultStatus: 'PENDING' }),
    [],
  );
  assert.deepEqual(
    planFulfilmentAutomation('ACCEPTED', { autoConfirm: true, defaultStatus: 'ACCEPTED' }),
    [],
  );
  assert.deepEqual(
    planFulfilmentAutomation('DELIVERED', { autoConfirm: true, defaultStatus: 'PROCESSING' }),
    [],
  );
});

test('cancelled orders never move and invalid settings fall back to PENDING', () => {
  assert.deepEqual(
    planFulfilmentAutomation('CANCELED', { autoConfirm: true, defaultStatus: 'PROCESSING' }),
    [],
  );
  assert.equal(resolveFulfilmentTarget({ autoConfirm: false, defaultStatus: 'PACKED' }), 'PENDING');
  assert.equal(resolveFulfilmentTarget({ autoConfirm: false, defaultStatus: 'CANCELED' }), 'PENDING');
  assert.equal(resolveFulfilmentTarget({ autoConfirm: true, defaultStatus: 'SHIPPED' }), 'ACCEPTED');
  assert.equal(resolveFulfilmentTarget({ autoConfirm: true, defaultStatus: 'ON_THE_WAY' }), 'ON_THE_WAY');
});

test('every planned step is a legal transition from the previous status', () => {
  for (const from of ['PENDING', 'ACCEPTED', 'PROCESSING', 'ON_THE_WAY', 'DELIVERED', 'CANCELED']) {
    for (const autoConfirm of [true, false]) {
      for (const defaultStatus of ['PENDING', 'ACCEPTED', 'PROCESSING', 'ON_THE_WAY', 'DELIVERED']) {
        const steps = planFulfilmentAutomation(from, { autoConfirm, defaultStatus });
        let previous = from;
        for (const step of steps) {
          assert.ok(
            FULFILMENT_TRANSITIONS[previous].includes(step),
            `${previous} -> ${step} must be legal`,
          );
          previous = step;
        }
      }
    }
  }
});
