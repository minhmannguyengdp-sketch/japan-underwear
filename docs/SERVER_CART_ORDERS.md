# Server cart and orders

## Business identity

- Product variant identity: `product_id + size_code + cup_code`.
- Color remains a product-level choice.
- Cart row identity: `cart_id + product_variant_id + color_id`.
- Order row identity: `order_id + product_variant_id + color_id`.
- `quantity` is stored on that row; it is not used to create duplicate selection rows.
- A database trigger rejects a color and variant that do not belong to the same product.
- No color × size/cup Cartesian inventory matrix is invented.

## Guest cart

The current release intentionally does not require login. Login remains behind stop gate #2.

A random UUID is stored in the HttpOnly `tt_cart` cookie. The cookie identifies one active server-side cart and uses:

- `HttpOnly`
- `SameSite=Lax`
- `Secure` in production
- 30-day lifetime

A converted cart cannot be submitted twice. Creating another cart after checkout generates a new token.

## Tables

Migration `0004_server_cart_orders.sql` adds only to schema `japan_underwear`:

- `carts`
- `cart_items`
- `orders`
- `order_items`

`order_items` stores immutable display snapshots for product code/name, color, size/cup, unit price, and line total while retaining foreign keys to the original variant and color.

## API

- `GET /api/cart`: read or create the active guest cart.
- `POST /api/cart/items`: add one or more selections atomically.
- `PATCH /api/cart/items/:itemId`: set quantity from 1 to 999.
- `DELETE /api/cart/items/:itemId`: remove one cart row.
- `POST /api/orders`: validate the active cart, re-read current authoritative prices, snapshot the order, and mark the cart converted in one transaction.

All write endpoints validate UUIDs and request bodies. The database performs a second same-product identity check.

## Checkout fields

The first order flow requires:

- customer name
- customer phone

Delivery address and note are optional so wholesale staff can confirm them later.

## Local verification

```powershell
git pull --ff-only origin feat/catalog-variant-ordering-ui
npm run db:migrate
npm run db:verify
npm run lint
npm run build
npm run dev
```

Smoke test:

1. Add the same model, color, and size/cup twice. Quantity must merge on one row.
2. Add the same variant in two colors. They must remain two rows.
3. Reload the page. The cart must remain.
4. Change quantity and delete a row.
5. Submit customer name and phone. A `TT-YYYYMMDD-XXXXXXXX` order code must appear.
6. Reload after checkout. The old cart must not submit again.
