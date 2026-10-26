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
  canTransitionReview,
  isReviewAction,
  isReviewStatus,
  maskEmail,
  rejectionReasonError,
  replyError,
} = await jiti.import(path.join(here, '..', 'src', 'lib', 'store-admin', 'review-rules.ts'));

test('only known review statuses and actions are accepted', () => {
  assert.equal(isReviewStatus('pending'), true);
  assert.equal(isReviewStatus('published'), true);
  assert.equal(isReviewStatus('rejected'), true);
  assert.equal(isReviewStatus('deleted'), false);
  assert.equal(isReviewStatus(null), false);

  assert.equal(isReviewAction('publish'), true);
  assert.equal(isReviewAction('reject'), true);
  assert.equal(isReviewAction('reply'), true);
  assert.equal(isReviewAction('delete'), false);
});

test('moderation moves between visible states only', () => {
  assert.equal(canTransitionReview('pending', 'published'), true);
  assert.equal(canTransitionReview('pending', 'rejected'), true);
  assert.equal(canTransitionReview('published', 'rejected'), true);
  assert.equal(canTransitionReview('rejected', 'published'), true);

  // No self-transition, and no way back to pending.
  assert.equal(canTransitionReview('published', 'published'), false);
  assert.equal(canTransitionReview('rejected', 'rejected'), false);
  assert.equal(canTransitionReview('published', 'pending'), false);
  assert.equal(canTransitionReview('rejected', 'pending'), false);
});

test('a rejection always carries a reason of at most 300 characters', () => {
  assert.match(rejectionReasonError(''), /required/i);
  assert.match(rejectionReasonError('   '), /required/i);
  assert.match(rejectionReasonError(undefined), /required/i);
  assert.match(rejectionReasonError('x'.repeat(301)), /300/);
  assert.equal(rejectionReasonError('Off-topic'), null);
  assert.equal(rejectionReasonError('x'.repeat(300)), null);
});

test('a store reply is required and capped at 2,000 characters', () => {
  assert.match(replyError(''), /required/i);
  assert.match(replyError(42), /required/i);
  assert.match(replyError('x'.repeat(2001)), /2,000/);
  assert.equal(replyError('Thanks for the feedback.'), null);
});

test('customer emails are masked before they reach the page', () => {
  assert.equal(maskEmail('priya@example.com'), 'p***@example.com');
  assert.equal(maskEmail('  ravi.k@mail.co.in '), 'r***@mail.co.in');
  assert.equal(maskEmail(''), '');
  // A malformed value must not leak the local part.
  assert.equal(maskEmail('not-an-email'), '***');
  assert.equal(maskEmail('@example.com'), '***');
});
