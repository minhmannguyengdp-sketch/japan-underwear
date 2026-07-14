# Customer order ownership

## Identity boundary

Customer ownership uses the internal UUID from `japan_underwear.users`. OAuth provider identifiers remain isolated in `auth_accounts` and are never used as business foreign keys.

## Checkout transaction

An authenticated checkout writes `orders.customer_user_id` in the same PostgreSQL transaction that creates the order snapshots and converts the source cart. The cart remains a cookie-scoped pre-checkout resource; it is not partially converted into an account resource.

## Legacy and staff orders

`orders.customer_user_id` is nullable. Orders created before customer ownership, and future staff-created orders without a resolved customer account, remain unowned and visible only through staff-authorized workflows. They are never guessed or backfilled from phone or email.

## Read authorization

Customer list and detail queries always include `customer_user_id = current_user_id`. Detail lookup also includes the normalized order code. Missing orders and orders owned by another customer return the same not-found response.

## Immutability

After an order has a non-null customer owner, the database trigger rejects reassignment. A legacy unowned order may be claimed once only by an explicit future audited workflow; this feature does not expose such a workflow to customers.
