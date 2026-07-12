# Audit màu, size/cup và nội dung sản phẩm

## Quy tắc nghiệp vụ

- Màu là thông tin tổng hợp ở cấp sản phẩm để hiển thị trên card và trang chi tiết.
- Khách không chọn màu khi thêm giỏ hàng.
- Variant đặt hàng được xác định bằng `product + size + cup`.
- Với quần lót và quần gen, `cup` có thể rỗng; variant khi đó chỉ theo size.
- Không tạo tích Descartes màu × size × cup.
- Không tự đoán màu từ ảnh, không tự đổi tên size/cup và không tự chọn giá khi nguồn mâu thuẫn.
- Mô tả website chỉ là nguồn tham chiếu. Nội dung app phải rút thành một câu ngắn và 3–5 tính năng chính, không sao chép phần giao hàng, đổi trả hoặc nội dung quảng cáo dài.

## Công cụ audit

Dùng file:

`scripts/browser-scrape-catalog.js`

Môi trường tự động có thể nhận 502 từ `https://tuanthuy.com.vn/`, nên script được chạy trong Chrome hoặc Edge đang mở được website.

1. Mở trang cửa hàng hoặc danh mục có nhiều sản phẩm.
2. Nhấn `F12`, mở tab **Console**.
3. Mở file script trên GitHub ở đúng branch, chọn **Raw**, sao chép toàn bộ và dán vào Console.
4. Khi hoàn tất, trình duyệt tải file:

`tuan-thuy-product-audit-YYYY-MM-DD.json`

Kết quả cũng nằm tại:

```js
window.__TT_CATALOG_SCRAPER_RESULT__
```

## Dữ liệu đầu ra quan trọng

Mỗi sản phẩm có:

- `modelCandidates`: mã model đọc từ tên, SKU hoặc URL để đối chiếu identity chuẩn.
- `colors`: danh sách màu tổng hợp từ thuộc tính trang và variation nguồn.
- `variants`: các lựa chọn đã gộp theo size/cup, không chứa màu trong identity.
- `featureCandidates`: các đoạn mô tả có khả năng là tính năng sản phẩm.
- `description`: mô tả gốc để đối chiếu, không import nguyên văn vào app.
- `blockers`: các lỗi phải xử lý trước khi import.

Ví dụ variant sau khi gộp:

```json
{
  "variantKey": "75::B",
  "size": "75",
  "cup": "B",
  "label": "75B",
  "sourceColors": ["Đen", "Da"],
  "price": 499000,
  "priceCandidates": [499000],
  "priceConsistent": true,
  "inStock": true
}
```

`sourceColors` chỉ chứng minh các variation màu đã được gom vào cùng size/cup. Trường này không được dùng làm khóa variant hoặc yêu cầu khách chọn màu.

## Blocker audit

Không import active variant khi có một trong các blocker:

- `no-size-cup-variants`: không đọc được size/cup thật.
- `unmapped-source-variation-options`: website có variation nhưng không xác định được chiều size/cup.
- `conflicting-prices-for-size-cup`: cùng size/cup có nhiều giá nguồn khác nhau.
- `missing-variant-price`: variant không xác định được giá.

Ngoài blocker tự động, importer phải dừng nếu một trang web map tới nhiều identity `brand + category + model`, hoặc nhiều trang map tới cùng identity mà chưa có quyết định hợp nhất.

## Mô hình DB mục tiêu

### `product_colors`

Giữ ở cấp sản phẩm:

- `product_id`
- `code`
- `name`
- `swatch` chỉ khi nguồn cung cấp giá trị thật
- `sort_order`
- `is_active`
- nguồn và timestamp audit

Unique key: `(product_id, code)`.

### `product_variants`

Không chứa `color_id` trong identity đặt hàng:

- `product_id`
- `size_code`
- `cup_code` nullable
- `display_label`
- `source_system`
- `source_variant_key`
- `sku` nếu nguồn thật có
- `price_override` khi bảng giá xác nhận size/cup có giá khác
- `is_active`
- timestamps

Business unique key:

`(product_id, size_code, coalesce(cup_code, ''))`

Source unique key:

`(source_system, source_variant_key)` khi source key khác null.

SKU không được coi là unique toàn hệ thống cho tới khi audit nguồn chứng minh quy tắc đó.

## Xử lý Winking 8001 / 8001-2X

- Chỉ có một product: `winking + quan-lot + 8001`.
- `8001-2X` là ứng viên variant size `2X`, không phải product mới.
- Chỉ map giá 54.000 vào variant `2X` khi website hoặc nguồn đã duyệt xác nhận `2X` là size thật của model này.
- Giá cơ bản 49.000 tiếp tục dùng cho các size thuộc mức giá cơ bản đã được nguồn xác nhận.

## Nội dung hiển thị trên app

Mỗi sản phẩm nên có:

- Một câu mô tả ngắn, khoảng 80–140 ký tự.
- Tối đa 3–5 tính năng chính.
- Không đưa chính sách bán hàng, vận chuyển, hotline hoặc đoạn quảng cáo chung vào mô tả sản phẩm.
- Không suy diễn chất liệu, công dụng hoặc cấu trúc áo nếu trang nguồn không nêu rõ.

Luồng đúng là: scrape mô tả gốc → tạo danh sách feature candidates → đối chiếu và rút gọn → review → import. Không sinh nội dung quảng cáo tự động rồi coi là dữ liệu thật.
