import test from 'node:test';
import assert from 'node:assert/strict';
import { createJiti } from 'jiti';
const jiti = createJiti(import.meta.url);
const { deriveDocumentState, projectCustomerDocumentState, parseCustomerDocumentMode } = await jiti.import('../src/lib/orders/document-policy.ts');
const payments = ['CREATED','PENDING','PROCESSING','PAID','FAILED','CANCELLED'];
const orders = ['PENDING','ACCEPTED','PROCESSING','ON_THE_WAY','DELIVERED','CANCELED'];
const refunds = [
  { refundedPaise:0,pendingRefundPaise:0 },
  { refundedPaise:0,pendingRefundPaise:500 },
  { refundedPaise:500,pendingRefundPaise:0 },
  { refundedPaise:1000,pendingRefundPaise:0 },
  { refundedPaise:500,pendingRefundPaise:500 },
];
test('all four-domain combinations forbid false payment proof', () => {
  let cases=0;
  for (const paymentStatus of payments) for (const fulfilmentStatus of orders)
  for (const shipmentStarted of [false,true]) for (const refund of refunds)
  for (const paymentReviewRequired of [false,true]) {
    const state=deriveDocumentState({ paymentStatus,fulfilmentStatus,shipmentStarted,paymentReviewRequired,
      totalPaise:1000,capturedPaise:paymentStatus==='PAID'?1000:0,billRequested:true,...refund });
    const bad=paymentStatus!=='PAID'||fulfilmentStatus==='CANCELED'||paymentReviewRequired||refund.refundedPaise>0||refund.pendingRefundPaise>0;
    if (bad) assert.equal(state.isPaymentProof,false,JSON.stringify({paymentStatus,fulfilmentStatus,refund}));
    if (paymentStatus!=='PAID'||paymentReviewRequired) assert.equal(state.kind,'status');
    if (fulfilmentStatus==='CANCELED') assert.notEqual(state.label,'Paid');
    assert.equal(state.paymentStatus,paymentStatus);
    cases++;
  }
  assert.equal(cases,720);
});
test('pre-shipment provisional bill requires successful payment and saved reason',()=>{
  const facts={paymentStatus:'PAID',fulfilmentStatus:'ACCEPTED',totalPaise:1000,capturedPaise:1000};
  assert.equal(deriveDocumentState(facts).canRequestBill,true);
  assert.equal(deriveDocumentState(facts).canViewBill,false);
  assert.equal(deriveDocumentState({...facts,billRequested:true}).kind,'provisional');
});
test('stable issued invoice survives cancellation with current refund stamp',()=>{
  const facts={paymentStatus:'PAID',fulfilmentStatus:'CANCELED',shipmentStarted:true,totalPaise:1000,capturedPaise:1000,
    invoiceNumber:'INV000001',invoiceIssuedAt:'2026-11-02T00:00:00Z'};
  const cancelled=deriveDocumentState(facts);
  assert.equal(cancelled.kind,'invoice'); assert.equal(cancelled.label,'Cancelled'); assert.equal(cancelled.isPaymentProof,false);
  const pending=deriveDocumentState({...facts,pendingRefundPaise:1000});
  assert.equal(pending.label,'Refund Initiated'); assert.equal(pending.retainedPaise,1000);
  const partial=deriveDocumentState({...facts,refundedPaise:500});
  assert.equal(partial.label,'Refund Successful — Partial'); assert.equal(partial.retainedPaise,500);
  assert.equal(deriveDocumentState({...facts,refundedPaise:1000}).label,'Refund Successful');
});
test('zero-total POS is not proof that money was received',()=>{
  const state=deriveDocumentState({paymentStatus:'PAID',fulfilmentStatus:'DELIVERED',totalPaise:0,channel:'pos'});
  assert.equal(state.label,'No payment required');assert.equal(state.isPaymentProof,false);
});
test('obligation alone does not claim refund initiated; legacy reads issue nothing',()=>{
  const state=deriveDocumentState({paymentStatus:'PAID',fulfilmentStatus:'CANCELED',shipmentStarted:true,totalPaise:1000,capturedPaise:1000,refundDuePaise:1000});
  assert.equal(state.label,'Cancelled');assert.equal(state.refundStatus,'NONE');assert.equal(state.kind,'legacy');assert.equal(state.invoiceNumber,null);
});
test('insufficient captured amount cannot yield paid proof',()=>{
  const state=deriveDocumentState({paymentStatus:'PAID',fulfilmentStatus:'ACCEPTED',totalPaise:1000,capturedPaise:999,billRequested:true});
  assert.equal(state.label,'Payment Pending');assert.equal(state.kind,'status');
});


test('customer capability matrix independently gates delivery and strips internal identity/request state', () => {
  let cases = 0;
  for (const paymentStatus of payments) for (const fulfilmentStatus of orders)
  for (const shipmentStarted of [false,true]) for (const refund of refunds)
  for (const paymentReviewRequired of [false,true]) for (const issued of [false,true]) {
    const internal = deriveDocumentState({ paymentStatus, fulfilmentStatus, shipmentStarted, paymentReviewRequired,
      totalPaise:1000, capturedPaise:paymentStatus==='PAID'?1000:0, billRequested:true, ...refund,
      invoiceNumber:issued?'HIDDEN-REF':null, invoiceIssuedAt:issued?'2026-11-02T00:00:00Z':null });
    const customer = projectCustomerDocumentState(internal);
    const paid = paymentStatus === 'PAID' && !paymentReviewRequired;
    const invoice = paid && fulfilmentStatus === 'DELIVERED' && issued;
    assert.equal(customer.canViewInvoice, invoice);
    assert.equal(customer.canViewReceipt, paid);
    assert.equal(customer.kind, invoice ? 'invoice' : paid ? 'receipt' : 'status');
    assert.equal(customer.invoiceNumber, invoice ? 'HIDDEN-REF' : null);
    assert.equal(customer.invoiceIssuedAt, invoice ? '2026-11-02T00:00:00Z' : null);
    assert.equal(customer.canRequestBill, false);
    assert.equal(customer.billRequested, false);
    const explicit = projectCustomerDocumentState(internal, 'invoice');
    assert.equal(explicit.kind, invoice ? 'invoice' : 'status');
    assert.equal(explicit.canViewBill, invoice, 'invoice mode never substitutes a receipt');
    const receipt = projectCustomerDocumentState(internal, 'receipt');
    assert.equal(receipt.kind, paid ? 'receipt' : 'status');
    assert.equal(receipt.invoiceNumber, null);
    assert.equal(receipt.invoiceIssuedAt, null);
    assert.equal(customer.refundStatus, internal.refundStatus);
    assert.equal(customer.label, internal.label);
    cases++;
  }
  assert.equal(cases, 1440);
});

test('customer explicit document modes reject unknown, empty and repeated values', () => {
  assert.equal(parseCustomerDocumentMode(undefined), undefined);
  for (const mode of ['receipt','invoice']) assert.equal(parseCustomerDocumentMode(mode), mode);
  for (const mode of ['', 'Invoice', 'bill', [], ['invoice'], ['invoice','receipt'], null, {}, 1])
    assert.equal(parseCustomerDocumentMode(mode), null);
});

test('customer legacy partial identities and insufficient capture never invent invoices', () => {
  const facts = { paymentStatus:'PAID', fulfilmentStatus:'DELIVERED', totalPaise:1000, capturedPaise:1000 };
  for (const identity of [{}, {invoiceNumber:'ONLY-NUMBER'}, {invoiceIssuedAt:'ONLY-DATE'}]) {
    const state = projectCustomerDocumentState(deriveDocumentState({...facts,...identity}));
    assert.equal(state.kind, 'receipt'); assert.equal(state.invoiceNumber, null); assert.equal(state.invoiceIssuedAt, null);
    assert.equal(projectCustomerDocumentState(deriveDocumentState({...facts,...identity}), 'invoice').canViewBill, false);
  }
  const underpaid = projectCustomerDocumentState(deriveDocumentState({...facts, capturedPaise:999}));
  assert.equal(underpaid.kind, 'status'); assert.equal(underpaid.canViewReceipt, false);
});
