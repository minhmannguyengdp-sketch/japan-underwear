import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = process.cwd();
const targetPath = path.resolve(root, "components", "catalog-ordering-v2.tsx");
const scriptPath = fileURLToPath(import.meta.url);

function replaceOnce(source, pattern, replacement, label) {
  const matches = source.match(pattern);
  if (!matches || matches.length !== 1) {
    throw new Error(`${label}: expected exactly one match, found ${matches?.length ?? 0}.`);
  }
  return source.replace(pattern, replacement);
}

let source = fs.readFileSync(targetPath, "utf8");

source = replaceOnce(
  source,
  /type CheckoutForm = \{\r?\n  customerName: string;\r?\n  customerPhone: string;\r?\n  deliveryAddress: string;\r?\n  note: string;\r?\n\};/g,
  `type CheckoutForm = {\n  note: string;\n};`,
  "checkout form type",
);

source = replaceOnce(
  source,
  /  const \[checkoutError, setCheckoutError\] = useState\(""\);\r?\n  const \[createdOrder, setCreatedOrder\] = useState<CreatedOrder \| null>\(null\);/g,
  `  const [checkoutError, setCheckoutError] = useState("");\n  const [checkoutRequestId, setCheckoutRequestId] = useState("");\n  const [createdOrder, setCreatedOrder] = useState<CreatedOrder | null>(null);`,
  "checkout request state",
);

source = replaceOnce(
  source,
  /  const \[checkout, setCheckout\] = useState<CheckoutForm>\(\{\r?\n    customerName: "",\r?\n    customerPhone: "",\r?\n    deliveryAddress: "",\r?\n    note: "",\r?\n  \}\);/g,
  `  const [checkout, setCheckout] = useState<CheckoutForm>({ note: "" });`,
  "checkout state",
);

source = replaceOnce(
  source,
  /      setCart\(body\.cart\);\r?\n      setSelectedId\(null\);\r?\n      setCartOpen\(true\);/g,
  `      setCart(body.cart);\n      setCheckoutRequestId(crypto.randomUUID());\n      setSelectedId(null);\n      setCartOpen(true);`,
  "cart add request reset",
);

source = replaceOnce(
  source,
  /      const body = await readJson<\{ cart: ServerCart \}>\(response\);\r?\n      setCart\(body\.cart\);\r?\n    \} catch \(updateError\)/g,
  `      const body = await readJson<{ cart: ServerCart }>(response);\n      setCart(body.cart);\n      setCheckoutRequestId(crypto.randomUUID());\n    } catch (updateError)`,
  "cart update request reset",
);

source = replaceOnce(
  source,
  /    setCartBusy\(true\);\r?\n    setCheckoutError\(""\);\r?\n    try \{\r?\n      const response = await fetch\("\/api\/orders", \{\r?\n        method: "POST",\r?\n        headers: \{ "Content-Type": "application\/json" \},\r?\n        body: JSON\.stringify\(\{\r?\n          \.\.\.checkout,\r?\n          location: checkoutLocation,\r?\n        \}\),/g,
  `    setCartBusy(true);\n    setCheckoutError("");\n    const requestId = checkoutRequestId || crypto.randomUUID();\n    if (!checkoutRequestId) setCheckoutRequestId(requestId);\n    try {\n      const response = await fetch("/api/orders", {\n        method: "POST",\n        headers: { "Content-Type": "application/json" },\n        body: JSON.stringify({\n          clientRequestId: requestId,\n          note: checkout.note,\n          location: checkoutLocation,\n        }),`,
  "checkout request payload",
);

source = replaceOnce(
  source,
  /      setCreatedOrder\(body\.order\);\r?\n      setCart\(EMPTY_CART\);\r?\n      setCheckout\(\{ customerName: "", customerPhone: "", deliveryAddress: "", note: "" \}\);/g,
  `      setCreatedOrder(body.order);\n      setCart(EMPTY_CART);\n      setCheckoutRequestId("");\n      setCheckout({ note: "" });`,
  "checkout success reset",
);

source = replaceOnce(
  source,
  /                  <p className="text-xs font-black uppercase tracking-\[0\.14em\] text-emerald-700">Đã tạo đơn<\/p>/g,
  `                  <p className="text-xs font-black uppercase tracking-[0.14em] text-emerald-700">\n                    {createdOrder.idempotentReplay ? "Đã xác nhận đơn cũ" : "Đã tạo đơn"}\n                  </p>`,
  "replay success label",
);

source = replaceOnce(
  source,
  /                  <p className="font-black">Thông tin tạo đơn<\/p>\r?\n                  <div className="mt-3 grid gap-3">\r?\n                    <input required minLength=\{2\} maxLength=\{120\} value=\{checkout\.customerName\} onChange=\{\(event\) => setCheckout\(\(current\) => \(\{ \.\.\.current, customerName: event\.target\.value \}\)\)\} placeholder="Tên khách hàng" className="h-11 rounded-xl border border-slate-200 px-3" \/>\r?\n                    <input required minLength=\{8\} maxLength=\{24\} value=\{checkout\.customerPhone\} onChange=\{\(event\) => setCheckout\(\(current\) => \(\{ \.\.\.current, customerPhone: event\.target\.value \}\)\)\} placeholder="Số điện thoại" className="h-11 rounded-xl border border-slate-200 px-3" \/>\r?\n                    <textarea maxLength=\{500\} value=\{checkout\.deliveryAddress\} onChange=\{\(event\) => setCheckout\(\(current\) => \(\{ \.\.\.current, deliveryAddress: event\.target\.value \}\)\)\} placeholder="Địa chỉ giao hàng \(có thể bổ sung sau\)" className="min-h-20 rounded-xl border border-slate-200 p-3" \/>\r?\n/g,
  `                  <p className="font-black">Xác nhận tạo đơn</p>\n                  <div className="mt-3 grid gap-3">\n                    <div className="rounded-xl border border-tt-purple-200 bg-tt-purple-50 p-3 text-sm leading-6 text-slate-700">\n                      Tên cửa hàng, người liên hệ, điện thoại và địa chỉ được đọc từ hồ sơ server.\n                      <a href="/tai-khoan" className="ml-1 font-black text-tt-purple-700 underline">\n                        Kiểm tra hồ sơ\n                      </a>\n                    </div>\n`,
  "profile-backed checkout form",
);

source = replaceOnce(
  source,
  /                    <textarea maxLength=\{1000\} value=\{checkout\.note\} onChange=\{\(event\) => setCheckout\(\(current\) => \(\{ \.\.\.current, note: event\.target\.value \}\)\)\} placeholder="Ghi chú" className="min-h-20 rounded-xl border border-slate-200 p-3" \/>/g,
  `                    <textarea maxLength={1000} value={checkout.note} onChange={(event) => setCheckout((current) => ({ ...current, note: event.target.value }))} placeholder="Ghi chú cho đơn hàng" className="min-h-20 rounded-xl border border-slate-200 p-3" />\n                    <p className="text-xs leading-5 text-slate-500">\n                      Retry dùng cùng một clientRequestId cho tới khi có kết quả chắc chắn. Nội dung giỏ thay đổi sẽ tạo key mới.\n                    </p>`,
  "checkout retry explanation",
);

if (
  source.includes("customerName: string") ||
  source.includes("checkout.customerName") ||
  !source.includes("clientRequestId: requestId") ||
  !source.includes("setCheckoutRequestId(crypto.randomUUID())")
) {
  throw new Error("Phase 6 client refactor did not produce the expected checkout code.");
}

fs.writeFileSync(targetPath, source);
fs.rmSync(scriptPath);

console.log("Phase 6 checkout client refactor OK.");
console.log("Checkout sends clientRequestId + note + optional location only.");
console.log("The same request id survives retries and changes only when the cart changes.");
console.log("Profile fields now come from the authenticated server profile.");
console.log("One-shot refactor script removed itself.");
