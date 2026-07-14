# Shared order creation and staff manual orders

## Goal

Customer checkout and staff-created orders must use one pricing and snapshot path. The UI is not a source of truth for price, availability, currency, item snapshots, audit, or outbox payloads.

## Order sources

`japan_underwear.orders.order_source` is one of:

- `legacy_cart`: historical cart-backed orders without a checkout request identity. A customer owner may be assigned once later; `client_request_id` remains null.
- `customer_checkout`: cart-backed and owned by a customer; requires `source_cart_id`, `customer_user_id`, and `client_request_id`.
- `staff_manual`: no cart; requires `created_by_user_id` and `manual_request_id`; may be linked to a customer account or remain a guest order.

The database derives a source only when a legacy/direct insert omits it. Application services pass the source explicitly.

## Shared writer

`lib/order-creation.ts` is the only application path that inserts new orders. It:

1. normalizes and consolidates variant/color selections;
2. reads current active product, variant, color, and price data under row locks;
3. rejects missing, inactive, cross-product, mixed-currency, quantity, and integer-overflow states;
4. writes the order and initial audit context;
5. writes immutable item snapshots;
6. writes one typed `order.submitted` outbox event;
7. returns the created order summary.

`lib/customer-checkout.ts` owns customer/profile/cart locking, checkout idempotency, and cart conversion. It delegates pricing and persistence to the shared writer.

`lib/manual-orders.ts` owns staff authorization context, linked-customer/guest rules, and manual request idempotency. It delegates pricing and persistence to the same writer.

## Idempotency

Customer checkout remains unique by:

```text
customer_user_id + client_request_id
```

Staff manual creation is unique by:

```text
created_by_user_id + manual_request_id
```

A retry returns the original order rather than inserting another order or outbox event.

## Database enforcement

Migration `0011_manual_order_shared_service.sql`:

- makes `source_cart_id` nullable only within the creation-identity constraint;
- adds source, manual request, and creator columns;
- adds the staff manual idempotency index;
- protects source/creator/request/cart identity from mutation;
- preserves one-time assignment of a legacy order owner;
- gives initial status audit events source-aware actor and idempotency defaults.

Only schema `japan_underwear` is modified.

## Verification

`verify-manual-order-shared-service.mjs` checks source architecture and runs rollback-only database fixtures for:

- manual pricing and item snapshots;
- linked customer ownership;
- initial status audit context;
- typed outbox payload;
- duplicate manual request rejection;
- invalid manual/cart identity rejection;
- immutable creator/request identity;
- compatibility source derivation for customer checkout inserts.
