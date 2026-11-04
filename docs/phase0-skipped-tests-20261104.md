# Phase 0 skipped tests — 4 November 2026

The fresh full suite ran 1,639 tests: 1,555 passed, none failed, and 84 were skipped. This list is extracted from the same run’s TAP and JUnit output, with every skipped test name reconciled between both reporters. No skip gates were added or relaxed by the Phase 0 repairs.

**All 84 need a PostgreSQL session connection** (direct or session pooler; transaction pooler port 6543 is rejected). They create and write isolated fixture schemas; the read-only catalogue connection does not authorize those writes. The database-related opt-in flags remained unset in this run. Authenticated application acceptance is a separate pending check; these fixtures do not establish it.

| Reason group | Tests | Execution gate | Session connection variable |
| --- | ---: | --- | --- |
| Legacy database integration | 68 | `RUN_LEGACY_DB_TESTS=1` | `DATABASE_URL` |
| PayU callback integration | 4 | `RUN_PAYU_CALLBACK_INTEGRATION=1` | `DATABASE_URL` |
| Phase 2 catalogue integration | 1 | `RUN_PHASE2_CATALOG_DB_TESTS=1 and PHASE2_CATALOG_APPROVED_MANIFEST` | `DATABASE_URL` |
| Phase 2 documents integration | 1 | `RUN_PHASE2_DB_TESTS=1 and PHASE2_APPROVED_MANIFEST` | `DATABASE_URL` |
| Phase 3 metadata integration | 1 | `RUN_PHASE3_DB_TESTS=1 and PHASE3_APPROVED_MANIFEST` | `DATABASE_URL` |
| Phase 4 stock integration | 1 | `RUN_PHASE4_DB_TESTS=1 and PHASE4_APPROVED_MANIFEST` | `DATABASE_URL` |
| Phase 5 coupon integration | 1 | `RUN_PHASE5_DB_TESTS=1 and PHASE5_APPROVED_MANIFEST` | `DATABASE_URL` |
| Shared list PostgreSQL acceptance | 1 | `RUN_SHARED_LIST_DB_TESTS=1 and SHARED_LIST_APPROVED_MANIFEST` | `SHARED_LIST_DATABASE_URL` |
| Shipping order integration | 6 | `RUN_SHIPPING_ORDER_INTEGRATION=1` | `DATABASE_URL` |

## Legacy database integration — 68 skipped

Recorded reason: legacy database tests require explicit RUN_LEGACY_DB_TESTS=1 approval.

Required: a session connection through `DATABASE_URL`, fixture write authorization, and `RUN_LEGACY_DB_TESTS=1`.

### [tests/coupon-db-integration.test.mjs](../tests/coupon-db-integration.test.mjs)

1. a valid code is priced from the database subtotal
2. an unknown code answers the generic refusal
3. a scoped coupon loads its targets and only discounts matching lines
4. category and brand targets load and match a mixed cart
5. sale-priced lines are skipped and the cart sees the sale message
6. a RESERVED use counts against the total limit, a RELEASED one does not
7. the per-customer limit counts the signed-in user and their email
8. only_new_customers reads the paid-order history by user or email
9. the group is read from the users row on the database clock
10. the row lock serialises two buyers competing for the last use
11. a reservation is consumed once, and duplicate callbacks are no-ops
12. a released reservation cannot be consumed or released twice
13. a late verified payment restores a released use when the limit allows
14. a late payment that cannot restore is flagged for review, not deleted
15. a refund restores a consumed use only through the explicit helper
16. a duplicate reservation for the same order is not double-counted
17. DELETE archives an unused coupon and refuses one with any redemption

### [tests/coupon-order-integration.test.mjs](../tests/coupon-order-integration.test.mjs)

18. free shipping zeroes the shipping charge, the order total and the PayU amount
19. sale-priced lines are skipped unless the code allows sale prices
20. category and brand scopes discount only the matching lines
21. a code that takes nothing off creates no order and no redemption
22. a scoped code with no matching line is refused before any write

### [tests/flash-sale-reconcile-integration.test.mjs](../tests/flash-sale-reconcile-integration.test.mjs)

23. lazy expiry: a checkout frees a sold-out unit when the cron is down
24. lazy expiry: a hold that has not expired is never taken by another checkout
25. lazy expiry: the failure grace is released but the order stays FAILED
26. lazy expiry: an unresolved payment keeps PROCESSING and is queued for the worker
27. lazy expiry: two buyers racing a stale hold produce exactly one order
28. reconcile: a verified capture becomes PAID and consumes the claim
29. reconcile: a verified failure waits out the grace window, then releases once
30. reconcile: an unresolved payment becomes PROCESSING, then releases and is flagged
31. reconcile: a late capture re-claims released stock
32. reconcile: a late capture without stock creates a refund obligation
33. reconcile: duplicate runs change nothing
34. reconcile: two workers at once process the order exactly once

### [tests/flash-sale-reservation-integration.test.mjs](../tests/flash-sale-reservation-integration.test.mjs)

35. one unit: a fresh checkout claims it, expiry releases it, and stock is re-checked
36. a definitive failure keeps the unit through the grace window, then releases once
37. an ambiguous payment stays processing and is never failed early
38. duplicate paid callbacks change stock exactly once
39. a verified payment racing expiry leaves one consistent paid order
40. the reconcile queue is a durable lease, not an in-memory timer
41. high concurrency: many buyers, one unit, exactly one order
42. removed waiting list: held units are returned once and the release is idempotent

### [tests/inventory-controls.test.mjs](../tests/inventory-controls.test.mjs)

43. tracking on without a stock row needs an opening count and records it

### [tests/late-payment-stock-integration.test.mjs](../tests/late-payment-stock-integration.test.mjs)

44. late payment re-claims released stock and continues normally
45. late payment with no stock flags the order, claims nothing and never retries
46. a late payment for a legacy order with no claim is paid without a flag

### [tests/maintenance-integration.test.mjs](../tests/maintenance-integration.test.mjs)

47. a callback settles the order while maintenance is on

### [tests/notifications-enqueue-integration.test.mjs](../tests/notifications-enqueue-integration.test.mjs)

48. enqueue follows the matrix, remembers why nothing was sent, and never duplicates
49. no outbox row for staff or password messages carries a credential

### [tests/notifications-outbox-integration.test.mjs](../tests/notifications-outbox-integration.test.mjs)

50. the outbox worker claims exclusively, retries with backoff, and stops
51. retention clears old finished bodies but keeps the audit trail

### [tests/order-cancel-stock-integration.test.mjs](../tests/order-cancel-stock-integration.test.mjs)

52. cancelling a paid order restores its claimed stock exactly once

### [tests/order-stock-integration.test.mjs](../tests/order-stock-integration.test.mjs)

53. two buyers of the last unit: one order, one 409 path

### [tests/pos-entered-prices.test.mjs](../tests/pos-entered-prices.test.mjs)

54. a typed decimal price is charged exactly and the list price is kept
55. empty, viewer, negative and unconfirmed free prices are refused
56. the unusual-price confirmation can be accepted or switched off
57. two tills racing for the last unit produce exactly one sale

### [tests/reports-correctness-integration.test.mjs](../tests/reports-correctness-integration.test.mjs)

58. reports match independent calculations on a known dataset
59. Overview figures match the reports under one revenue definition

### [tests/sale-admin.test.mjs](../tests/sale-admin.test.mjs)

60. sale settings convert store-local times with the store timezone
61. bulk sale prices write history and clearing marks every row

### [tests/sale-boundary-display.test.mjs](../tests/sale-boundary-display.test.mjs)

62. a database read caches the regular price even while a sale is live
63. turning the sale on and off is visible from the next request, with no wait
64. a sale window that has not started yet is off on the first request

### [tests/sale-price-entry.test.mjs](../tests/sale-price-entry.test.mjs)

65. a decimal sale price is stored exactly and history records the paise

### [tests/sale-pricing.test.mjs](../tests/sale-pricing.test.mjs)

66. sale price writes append marked history rows and require a lower price

### [tests/staff-accounts-integration.test.mjs](../tests/staff-accounts-integration.test.mjs)

67. real staff removal frees email, revokes sessions and preserves immutable history

### [tests/stock-behaviour.test.mjs](../tests/stock-behaviour.test.mjs)

68. click-time availability reads stock and the sale switch on one clock

## PayU callback integration — 4 skipped

Recorded reason: opt-in only: database-test approval required.

Required: a session connection through `DATABASE_URL`, fixture write authorization, and `RUN_PAYU_CALLBACK_INTEGRATION=1`.

### [tests/payu-callback-integration.test.mjs](../tests/payu-callback-integration.test.mjs)

69. concurrent duplicate callbacks pay once with one history and stock claim
70. failure then late capture reclaims stock, stale failure cannot downgrade paid
71. gateway id cannot pay two orders; signed mismatches cannot pay
72. timeline migration enforces append-only rows and RLS

## Phase 2 catalogue integration — 1 skipped

Recorded reason: Separate explicit target/manifest write approval required.

Required: a session connection through `DATABASE_URL`, fixture write authorization, and `RUN_PHASE2_CATALOG_DB_TESTS=1 and PHASE2_CATALOG_APPROVED_MANIFEST`.

### [tests/phase2-catalog-integration.test.mjs](../tests/phase2-catalog-integration.test.mjs)

73. actual 0055-57 migrations, independent races and private history in owned disposable schema

## Phase 2 documents integration — 1 skipped

Recorded reason: Phase2 database writes require explicit manifest approval.

Required: a session connection through `DATABASE_URL`, fixture write authorization, and `RUN_PHASE2_DB_TESTS=1 and PHASE2_APPROVED_MANIFEST`.

### [tests/phase2-documents-integration.test.mjs](../tests/phase2-documents-integration.test.mjs)

74. Phase2 invoice, retired bill request and refund transactions in approved private schema

## Phase 3 metadata integration — 1 skipped

Recorded reason: Phase3 database writes require separate manifest approval.

Required: a session connection through `DATABASE_URL`, fixture write authorization, and `RUN_PHASE3_DB_TESTS=1 and PHASE3_APPROVED_MANIFEST`.

### [tests/phase3-metadata-integration.test.mjs](../tests/phase3-metadata-integration.test.mjs)

75. Phase3 actual migration and metadata/duplicate service transactions in private approved schema

## Phase 4 stock integration — 1 skipped

Recorded reason: Phase4 SQL writes require separate manifest approval; not SQL proof.

Required: a session connection through `DATABASE_URL`, fixture write authorization, and `RUN_PHASE4_DB_TESTS=1 and PHASE4_APPROVED_MANIFEST`.

### [tests/phase4-stock-integration.test.mjs](../tests/phase4-stock-integration.test.mjs)

76. Phase4 actual migration and injected stock helpers in owned schema

## Phase 5 coupon integration — 1 skipped

Recorded reason: Phase5 SQL writes require separate hostname/count/manifest approval.

Required: a session connection through `DATABASE_URL`, fixture write authorization, and `RUN_PHASE5_DB_TESTS=1 and PHASE5_APPROVED_MANIFEST`.

### [tests/phase5-coupon-integration.test.mjs](../tests/phase5-coupon-integration.test.mjs)

77. Phase5 actual migration, customer isolation and atomically audited administration

## Shared list PostgreSQL acceptance — 1 skipped

Recorded reason: Pending separate exact-target/code approval; no PostgreSQL client constructed.

Required: a session connection through `SHARED_LIST_DATABASE_URL`, fixture write authorization, and `RUN_SHARED_LIST_DB_TESTS=1 and SHARED_LIST_APPROVED_MANIFEST`.

### [tests/shared-list-integration.test.mjs](../tests/shared-list-integration.test.mjs)

78. PostgreSQL shared lists: actual migrations, engine parity, constraints, services and bounded optional race

## Shipping order integration — 6 skipped

Recorded reason: opt-in only: set RUN_SHIPPING_ORDER_INTEGRATION=1 after database-test approval.

Required: a session connection through `DATABASE_URL`, fixture write authorization, and `RUN_SHIPPING_ORDER_INTEGRATION=1`.

### [tests/shipping-order-integration.test.mjs](../tests/shipping-order-integration.test.mjs)

79. canonical ₹50/₹999 policy covers examples and threshold boundaries
80. no-coupon shipping changes return TotalChangedError and roll back stock/order/history
81. sale activation changes the authoritative subtotal and returns a complete 409 payload
82. percent coupon discounts the sale-priced subtotal before shipping
83. free-shipping coupon overrides the configured charge and preserves the order history snapshot
84. successful orders retain immutable shipping even when current settings change

The six manifest-gated top-level tests cover nested SQL assertions that do not register until their opt-in parent executes. The count of 84 refers to the skipped tests registered in the default full suite, not the eventual number of nested PostgreSQL assertions.
