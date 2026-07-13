# Audit màu, size/cup và nội dung sản phẩm

## Quy tắc nghiệp vụ

- Màu là thông tin tổng hợp ở cấp sản phẩm để hiển thị trên card và khu chọn hàng trong trang chi tiết.
- Màu chỉ là nhãn tham khảo; không phải nút chọn, không đổi gallery và không tham gia identity của dòng giỏ hàng.
- Khách chỉ chọn `size + cup` để thêm giỏ hàng.
- Variant đặt hàng được xác định bằng `product + size + cup`.
- Với quần lót và quần gen, `cup` có thể rỗng; variant khi đó chỉ theo size.
- Không tạo tích Descartes màu × size × cup.
- Không nhân chéo danh sách size và cup khi website không cung cấp tổ hợp variation thật.
- Website Tuấn Thủy có thể không công bố màu. Thiếu màu không phải blocker đặt hàng và không được tự điền màu giả.
- Màu có thể được bổ sung sau bằng một đợt audit riêng từ gallery ảnh thật trong app, có review trước khi import.
- Không tự đổi tên size/cup và không tự chọn giá khi nguồn mâu thuẫn.
- Mô tả website chỉ là nguồn tham chiếu. Nội dung app phải rút thành một câu ngắn và 3–5 tính năng chính, không sao chép phần giao hàng, đổi trả hoặc nội dung quảng cáo dài.

## Hành vi UI đã chốt

Trong modal hoặc trang chi tiết sản phẩm:

1. Gallery hiển thị toàn bộ ảnh của model theo thứ tự hiện có.
2. Khu `Màu tham khảo` hiển thị dạng text/chip nhỏ, không có trạng thái selected và không có `onClick`.
3. Khu chọn hàng chỉ có size, cup và số lượng.
4. Việc bấm tên màu không được đổi ảnh; tốt nhất render bằng phần tử không tương tác để tránh gây hiểu nhầm.
5. Sản phẩm vẫn được đặt hàng khi màu chưa audit, miễn variant size/cup và giá đã hợp lệ.

Không gắn từng ảnh vào từng màu. Làm như vậy sẽ buộc đổi tên hoặc phân loại hàng trăm ảnh, dễ tạo mapping sai và không phục vụ nghiệp vụ đặt hàng hiện tại.

## Công cụ audit website

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

## Dữ liệu đầu ra từ website

Mỗi sản phẩm có:

- `modelCandidates`: mã model đọc từ tên, SKU hoặc URL để đối chiếu identity chuẩn.
- `colors`: màu chỉ được giữ khi website thực sự công bố; mảng rỗng là hợp lệ.
- `availableSizes` và `availableCups`: lựa chọn hiển thị trên trang, dùng để audit chứ chưa mặc nhiên là tổ hợp mua được.
- `variants`: các lựa chọn có bằng chứng đã gộp theo size/cup, không chứa màu trong identity.
- `featureCandidates`: các đoạn mô tả có khả năng là tính năng sản phẩm.
- `description`: mô tả gốc để đối chiếu, không import nguyên văn vào app.
- `blockers`: các lỗi phải xử lý trước khi import variant.

Ví dụ variant sau khi gộp:

```json
{
  "variantKey": "75::B",
  "size": "75",
  "cup": "B",
  "label": "75B",
  "sourceColors": [],
  "price": 499000,
  "priceCandidates": [499000],
  "priceConsistent": true,
  "inStock": true
}
```

`sourceColors` chỉ lưu bằng chứng nếu website có variation màu. Trường này không được dùng làm khóa variant, không bắt khách chọn màu và không tạo liên kết ảnh–màu.

## Blocker audit variant

Không import active variant khi có một trong các blocker:

- `no-size-cup-variants`: không đọc được size/cup thật.
- `unverified-size-cup-combinations`: trang có select size và cup riêng nhưng không có dữ liệu variation chứng minh tổ hợp hợp lệ.
- `unmapped-source-variation-options`: website có variation nhưng không xác định được chiều size/cup.
- `conflicting-prices-for-size-cup`: cùng size/cup có nhiều giá nguồn khác nhau.
- `missing-variant-price`: variant không xác định được giá.

Thiếu màu không phải blocker.

Ngoài blocker tự động, importer phải dừng nếu một trang web map tới nhiều identity `brand + category + model`, hoặc nhiều trang map tới cùng identity mà chưa có quyết định hợp nhất.

## Audit màu từ ảnh trong app

Audit màu là giai đoạn độc lập, thực hiện sau khi size/cup, giá và mô tả đã ổn định.

Nguồn audit là gallery ảnh thật đã có trong R2/DB của từng product. Không đổi tên file và không di chuyển object R2 chỉ để phục vụ màu.

Mỗi đề xuất màu nên lưu trong một manifest reviewable:

```json
{
  "productKey": "winking:ao-nguc:9003",
  "proposals": [
    {
      "name": "Đen",
      "code": "den",
      "evidenceImageIds": ["image-uuid-1", "image-uuid-4"],
      "confidence": "high"
    }
  ],
  "status": "pending-review"
}
```

Quy tắc:

- Agent chỉ đề xuất màu nhìn thấy rõ từ nhiều ảnh hoặc từ một ảnh có bằng chứng mạnh.
- Không suy màu từ tên file, ánh sáng nền, da người mẫu hoặc chi tiết nhỏ.
- Không bắt buộc mỗi ảnh phải có một màu.
- Không bắt buộc mỗi màu phải trỏ tới một ảnh đại diện.
- Màu mơ hồ giữ `pending-review`, không import.
- Chỉ sau review mới upsert `product_colors`.
- `swatch` để null nếu chưa có mã màu được xác nhận; UI có thể hiển thị chip chữ thay vì chấm màu.

Kết quả màu là danh sách tổng hợp của product, không phải ma trận màu × size/cup.

## Mô hình DB mục tiêu

### `product_colors`

Giữ ở cấp sản phẩm:

- `product_id`
- `code`
- `name`
- `swatch` nullable
- `source_system`: `website`, `image_audit`, `owner_review`
- `evidence` hoặc reference tới manifest audit
- `sort_order`
- `is_active`
- timestamps

Unique key: `(product_id, code)`.

Bảng này có thể rỗng trong lần import variant đầu tiên.

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
- Màu của model 8001 không ảnh hưởng tới hai mức giá trên.

## Nội dung hiển thị trên app

Mỗi sản phẩm nên có:

- Một câu mô tả ngắn, khoảng 80–140 ký tự.
- Tối đa 3–5 tính năng chính.
- Không đưa chính sách bán hàng, vận chuyển, hotline hoặc đoạn quảng cáo chung vào mô tả sản phẩm.
- Không suy diễn chất liệu, công dụng hoặc cấu trúc áo nếu trang nguồn không nêu rõ.

Luồng đúng là: scrape mô tả gốc → tạo danh sách feature candidates → đối chiếu và rút gọn → review → import. Không sinh nội dung quảng cáo tự động rồi coi là dữ liệu thật.
