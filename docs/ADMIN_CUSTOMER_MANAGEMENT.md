# Admin customer management

## Scope

The staff customer area is available at `/admin/khach-hang`.

- `sales` and `admin` can read customer summaries and detail.
- only `admin` can block or unblock a customer account.
- customer rows are sourced from the internal UUID identity, not Google provider IDs.
- profile data comes from `japan_underwear.customer_profiles`.
- order totals are calculated from owned orders using `orders.customer_user_id`.

## Read model

The list joins:

- `users` for identity, status and last login;
- `user_roles` for server-authorized roles;
- `customer_profiles` for store/contact/phone/address;
- `auth_sessions` for current session count;
- `orders` for count, lifetime value and latest order date.

Search is server-side across email, Google name, store, contact, phone and address. The result is capped at 100 rows.

## Status mutation

`PATCH /api/admin/customers/:userId/status` accepts `active` or `blocked`.

The service:

1. requires the current user to have the `admin` role;
2. locks the target `users` row;
3. rejects self-blocking;
4. rejects blocking the last active admin;
5. sets `app.auth_actor` to the staff identity;
6. updates `users.status`.

The existing database trigger is the single source of truth for side effects:

- blocking deletes every database session for the target user;
- `user.blocked` or `user.unblocked` is written to `auth_audit_events`;
- the number of revoked sessions is stored in audit details.

## Verification

`npm run db:verify` includes `verify-admin-customer-management.mjs`.

The verifier creates a temporary customer/profile/session inside a transaction, checks the read model, blocks and unblocks the fixture, verifies session revocation and audit actor/details, then rolls the transaction back.
