# Phase 6 checkout and onboarding

## Customer profile boundary

`japan_underwear.customer_profiles` stores one server-owned checkout profile per internal auth user UUID:

- store name;
- contact name;
- phone;
- default delivery address.

The browser may edit this profile through the authenticated account API, but checkout reads it again inside the database transaction. Order snapshots are never trusted from arbitrary checkout payload fields.

## Idempotency

Each authenticated checkout has a UUID `clientRequestId`. The database enforces one order per `(customer_user_id, client_request_id)`.

The checkout service also takes a transaction-scoped advisory lock for that pair before looking up or creating an order. Concurrent duplicate requests serialize. A replay returns the original order and does not create new order items, status history, outbox events, or cart conversions.

For older clients that do not yet send `clientRequestId`, the HttpOnly cart UUID is used as a compatibility key. New clients should send and retain an explicit UUID until a definitive response is received.

## Transactional outbox

A new order writes exactly one pending `order.submitted` row in `japan_underwear.outbox_events`. The order, item snapshots, initial status history, outbox event, and cart conversion commit or roll back together.

The outbox table is delivery-neutral. A future dispatcher may claim pending rows and mark them published or failed without changing checkout correctness.

## Retry and cart safety

The cart is converted only after the order, item snapshots, and outbox event have been written. Any error rolls the transaction back, leaving the cart active.

If the transaction commits but the HTTP response is lost, retrying with the same `clientRequestId` returns the original order. The response then clears the stale cart cookie.

## Legacy data

Existing orders keep nullable `client_request_id` and `customer_store_name`. They are not guessed or backfilled. New customer checkouts always write both fields from authenticated server state.
