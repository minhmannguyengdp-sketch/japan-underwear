# Thu thập catalog Tuấn Thủy

## Mục tiêu

Thu thập dữ liệu công khai từ website Tuấn Thủy để tạo nguồn import ban đầu cho ứng dụng đặt hàng:

- Tên sản phẩm
- SKU/mã hàng nếu website có
- Giá bán
- Giá so sánh/giá cũ nếu có
- Danh mục và thương hiệu
- Ảnh
- Trạng thái còn hàng
- Size dưới dạng biến thể
- URL nguồn để đối chiếu

Không lấy dữ liệu tài khoản, giỏ hàng, checkout, cookie hay thông tin khách hàng.

## Trạng thái truy cập

Môi trường tự động hiện không tải được `https://tuanthuy.com.vn/` và nhận phản hồi 502. Vì vậy repo có sẵn script chạy ngay trong trình duyệt của người có thể mở website bình thường:

`scripts/browser-scrape-catalog.js`

Script chỉ gọi các URL cùng domain, có độ trễ mặc định 700 ms và xuất dữ liệu thành JSON.

## Cách chạy bằng F12

1. Mở `https://tuanthuy.com.vn/` bằng Chrome/Edge và đảm bảo trang hiển thị bình thường.
2. Nên mở trang cửa hàng hoặc trang danh mục có nhiều sản phẩm nhất.
3. Nhấn `F12` và chọn tab **Console**.
4. Mở file `scripts/browser-scrape-catalog.js` trong GitHub, chọn **Raw**, sao chép toàn bộ nội dung rồi dán vào Console.
5. Trường hợp Chrome chặn thao tác dán, làm theo hướng dẫn hiển thị trong Console của chính trình duyệt.
6. Nhấn Enter và giữ nguyên tab trong lúc script chạy.
7. Khi hoàn tất, trình duyệt tự tải file dạng:

   `tuan-thuy-catalog-YYYY-MM-DD.json`

Kết quả cũng nằm tạm trong biến:

```js
window.__TT_CATALOG_SCRAPER_RESULT__
```

Kiểm tra nhanh năm sản phẩm đầu:

```js
window.__TT_CATALOG_SCRAPER_RESULT__.products.slice(0, 5)
```

Kiểm tra sản phẩm không có giá:

```js
window.__TT_CATALOG_SCRAPER_RESULT__.products.filter((product) => product.price == null)
```

Kiểm tra sản phẩm không đọc được size:

```js
window.__TT_CATALOG_SCRAPER_RESULT__.products.filter((product) => product.variants.length === 0)
```

## Dữ liệu đầu ra

Mỗi sản phẩm có cấu trúc chính:

```json
{
  "sourceUrl": "https://tuanthuy.com.vn/...",
  "sourceKey": "slug-san-pham",
  "name": "Tên sản phẩm",
  "sku": "Mã hàng",
  "brand": "Thương hiệu",
  "category": "Danh mục",
  "description": "Mô tả",
  "price": 199000,
  "compareAtPrice": 249000,
  "currency": "VND",
  "inStock": true,
  "images": ["https://.../image.webp"],
  "variants": [
    {
      "variantKey": "sku-size-m",
      "externalId": "123",
      "sku": "SKU-M",
      "options": { "size": "M" },
      "price": 199000,
      "compareAtPrice": 249000,
      "inStock": true,
      "image": null
    }
  ]
}
```

Size luôn được giữ trong `variants[].options.size`, không nối vào tên sản phẩm.

## Cách script tìm dữ liệu

Thứ tự ưu tiên:

1. JSON-LD loại `Product` trong HTML.
2. Dữ liệu biến thể WooCommerce trong `data-product_variations`.
3. Các trường HTML chuẩn như `itemprop=price`, `.price`, `.sku`.
4. Select, swatch hoặc button có thông tin size/variation.
5. Open Graph cho tên và ảnh dự phòng.

Giá và tổng đơn trong ứng dụng sau này vẫn phải được kiểm tra lại ở backend. File scrape chỉ là nguồn nhập catalog, không phải nguồn quyết định giá tại checkout.

## Tùy chỉnh trước khi chạy

Có thể khai báo cấu hình trong Console trước khi dán script:

```js
window.__TT_SCRAPER_CONFIG__ = {
  startUrl: location.href,
  delayMs: 1000,
  maxListingPages: 300,
  maxProducts: 5000,
  maxDepth: 6,
  listingHints: [
    "/danh-muc-san-pham/",
    "/product-category/",
    "/shop/",
    "/page/"
  ]
};
```

Tăng `delayMs` nếu website phản hồi chậm hoặc trả lỗi giới hạn truy cập.

## Khi kết quả bằng 0 hoặc thiếu nhiều sản phẩm

### Trường hợp 1: Link sản phẩm dùng cấu trúc lạ

Chạy script từ trang danh mục thay vì trang chủ. Sau đó bổ sung path vào `productHints` hoặc selector trong hàm `productLinks()`.

### Trường hợp 2: Website render sản phẩm bằng JavaScript

HTML tải bằng `fetch()` có thể chỉ là khung rỗng. Mở:

`F12 -> Network -> Fetch/XHR`

Sau đó tải lại trang, chuyển danh mục hoặc bấm tải thêm. Tìm request trả về JSON có tên, giá, SKU hoặc size.

Có thể dùng **Copy as fetch** để ghi nhận request mẫu, nhưng phải xóa cookie, token, Authorization và dữ liệu cá nhân trước khi đưa vào repo hoặc gửi cho người khác.

### Trường hợp 3: Giá chỉ xuất hiện sau khi chọn size

Kiểm tra request XHR lúc đổi size. Nếu response chứa `variation_id`, giá và tồn kho thì nên viết importer dựa trên endpoint đó thay vì mô phỏng click.

### Trường hợp 4: Website chặn request tự động

Giữ tốc độ thấp, chạy trong phiên trình duyệt bình thường và không tăng đồng thời. Không tìm cách vượt CAPTCHA hoặc cơ chế kiểm soát truy cập.

## Kiểm tra chất lượng trước khi import

Tối thiểu phải kiểm tra:

- Tổng số sản phẩm so với website
- Sản phẩm thiếu `name`
- Sản phẩm thiếu `price`
- SKU trùng
- `sourceKey` trùng
- Sản phẩm có size trên web nhưng `variants` rỗng
- Giá variant khác giá sản phẩm gốc
- URL ảnh lỗi
- Sản phẩm hết hàng

Chọn ít nhất 20 sản phẩm đại diện, gồm sản phẩm một size, nhiều size, có giá khuyến mãi, hết hàng và thiếu SKU để đối chiếu thủ công.

## Mapping vào database

- `products.source_key <- sourceKey`
- `products.name <- name`
- `products.sku <- sku` khi sản phẩm không có SKU riêng theo size
- `products.base_price <- price`
- `products.source_url <- sourceUrl`
- `product_variants.source_key <- variantKey`
- `product_variants.sku <- variants[].sku`
- `product_variants.options <- variants[].options`
- `product_variants.price <- variants[].price`
- `product_images.object_key` chỉ được điền sau khi ảnh đã được tải và đưa lên R2

Importer phải upsert idempotent và chuyển sản phẩm biến mất khỏi nguồn sang `inactive`, không hard delete.
