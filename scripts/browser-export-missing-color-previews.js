/* Export resized image previews for the 30 missing-color products.
 * Paste into DevTools Console while viewing https://tuanthuy.com.vn.
 */
(async () => {
  "use strict";

  if (window.__TT_MISSING_COLOR_PREVIEW_EXPORT_RUNNING__) {
    console.warn("TT missing-color preview export is already running.");
    return;
  }
  window.__TT_MISSING_COLOR_PREVIEW_EXPORT_RUNNING__ = true;

  const TARGETS = [
    ["winking:ao-nguc:5002", "https://tuanthuy.com.vn/san-pham/ao-nguc-winking-5002/", "https://tuanthuy.com.vn/wp-content/uploads/2024/02/TT5002.png"],
    ["winking:ao-nguc:5003", "https://tuanthuy.com.vn/san-pham/ao-nguc-winking-5003/", "https://tuanthuy.com.vn/wp-content/uploads/2024/02/AL5003-1.png"],
    ["winking:ao-nguc:9050", "https://tuanthuy.com.vn/san-pham/ao-nguc-winking-9050/", "https://tuanthuy.com.vn/wp-content/uploads/2024/03/AL9050-1.png"],
    ["pensee:ao-nguc:9501", "https://tuanthuy.com.vn/san-pham/ao-nguc-pensee-9501/", "https://tuanthuy.com.vn/wp-content/uploads/2024/02/01.png"],
    ["pensee:ao-nguc:9503", "https://tuanthuy.com.vn/san-pham/ao-nguc-pensee-9503/", "https://tuanthuy.com.vn/wp-content/uploads/2024/02/03.png"],
    ["pensee:ao-nguc:9504", "https://tuanthuy.com.vn/san-pham/ao-nguc-pensee-9504/", "https://tuanthuy.com.vn/wp-content/uploads/2024/02/04.png"],
    ["pensee:ao-nguc:9505", "https://tuanthuy.com.vn/san-pham/ao-nguc-pensee-9505/", "https://tuanthuy.com.vn/wp-content/uploads/2024/02/05.png"],
    ["pensee:ao-nguc:9506", "https://tuanthuy.com.vn/san-pham/ao-nguc-pensee-9506/", "https://tuanthuy.com.vn/wp-content/uploads/2024/02/9506.png"],
    ["pensee:ao-nguc:9507", "https://tuanthuy.com.vn/san-pham/ao-nguc-pensee-9507/", "https://tuanthuy.com.vn/wp-content/uploads/2024/02/9507.png"],
    ["pensee:ao-nguc:9508", "https://tuanthuy.com.vn/san-pham/ao-nguc-pensee-9508/", "https://tuanthuy.com.vn/wp-content/uploads/2024/02/08.png"],
    ["pensee:ao-nguc:9509", "https://tuanthuy.com.vn/san-pham/ao-nguc-pensee-9509/", "https://tuanthuy.com.vn/wp-content/uploads/2024/02/9509.png"],
    ["pensee:ao-nguc:9510", "https://tuanthuy.com.vn/san-pham/ao-nguc-pensee-9510/", "https://tuanthuy.com.vn/wp-content/uploads/2024/02/9510.png"],
    ["pensee:ao-nguc:9511", "https://tuanthuy.com.vn/san-pham/ao-nguc-pensee-9511/", "https://tuanthuy.com.vn/wp-content/uploads/2024/02/PS9511.png"],
    ["pensee:ao-nguc:9512", "https://tuanthuy.com.vn/san-pham/ao-nguc-pensee-9512/", "https://tuanthuy.com.vn/wp-content/uploads/2024/02/PS9512-2.png"],
    ["pensee:ao-nguc:9513", "https://tuanthuy.com.vn/san-pham/ao-nguc-pensee-9513/", "https://tuanthuy.com.vn/wp-content/uploads/2024/02/9513.png"],
    ["pensee:ao-nguc:9514", "https://tuanthuy.com.vn/san-pham/ao-nguc-pensee-9514/", "https://tuanthuy.com.vn/wp-content/uploads/2024/02/9514.png"],
    ["pensee:ao-nguc:9515", "https://tuanthuy.com.vn/san-pham/ao-nguc-pensse-9515/", "https://tuanthuy.com.vn/wp-content/uploads/2024/02/9515.png"],
    ["pensee:ao-nguc:9517", "https://tuanthuy.com.vn/san-pham/ao-nguc-pensee-95167/", "https://tuanthuy.com.vn/wp-content/uploads/2024/02/17.png"],
    ["pensee:ao-nguc:9518", "https://tuanthuy.com.vn/san-pham/ao-nguc-pensee-9518/", "https://tuanthuy.com.vn/wp-content/uploads/2024/02/9518.png"],
    ["pensee:ao-nguc:9519", "https://tuanthuy.com.vn/san-pham/ao-nguc-pensee-9519/", "https://tuanthuy.com.vn/wp-content/uploads/2024/02/PS9519-1.png"],
    ["pensee:ao-nguc:9523", "https://tuanthuy.com.vn/san-pham/ao-nguc-pensee-9523/", "https://tuanthuy.com.vn/wp-content/uploads/2024/03/9523.png"],
    ["pensee:ao-nguc:9524", "https://tuanthuy.com.vn/san-pham/ao-nguc-pensee-9524/", "https://tuanthuy.com.vn/wp-content/uploads/2024/02/24.png"],
    ["pensee:ao-nguc:9525", "https://tuanthuy.com.vn/san-pham/ao-nguc-pensee-9525/", "https://tuanthuy.com.vn/wp-content/uploads/2024/02/25.png"],
    ["pensee:ao-nguc:9526", "https://tuanthuy.com.vn/san-pham/ao-nguc-pensee-9526/", "https://tuanthuy.com.vn/wp-content/uploads/2024/02/PS9526-2.png"],
    ["pensee:ao-nguc:9529", "https://tuanthuy.com.vn/san-pham/ao-nguc-pensee-9529/", "https://tuanthuy.com.vn/wp-content/uploads/2024/02/9529.png"],
    ["pensee:ao-nguc:9530", "https://tuanthuy.com.vn/san-pham/ao-nguc-pensee-9530/", "https://tuanthuy.com.vn/wp-content/uploads/2024/02/9530-1.png"],
    ["pensee:ao-nguc:9531", "https://tuanthuy.com.vn/san-pham/ao-nguc-pensee-9531/", "https://tuanthuy.com.vn/wp-content/uploads/2024/02/9531.png"],
    ["pensee:ao-nguc:9532", "https://tuanthuy.com.vn/san-pham/ao-nguc-pensee-9532/", "https://tuanthuy.com.vn/wp-content/uploads/2024/02/9532-1.png"],
    ["pensee:ao-nguc:9535", "https://tuanthuy.com.vn/san-pham/ao-nguc-pensee-9535/", "https://tuanthuy.com.vn/wp-content/uploads/2024/02/35.png"],
    ["pensee:ao-nguc:9536", "https://tuanthuy.com.vn/san-pham/ao-nguc-pensee-9536/", "https://tuanthuy.com.vn/wp-content/uploads/2024/02/36.png"],
  ];

  const MAX_EDGE = 900;
  const WEBP_QUALITY = 0.88;
  const products = [];
  const errors = [];

  async function resizeToDataUrl(imageUrl) {
    const response = await fetch(imageUrl, { credentials: "include" });
    if (!response.ok) throw new Error(`Image HTTP ${response.status}`);
    const blob = await response.blob();
    const bitmap = await createImageBitmap(blob);
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { alpha: true });
    if (!context) throw new Error("Canvas 2D unavailable");
    context.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();
    return {
      width,
      height,
      originalType: blob.type || null,
      previewDataUrl: canvas.toDataURL("image/webp", WEBP_QUALITY),
    };
  }

  for (const [key, sourceUrl, imageUrl] of TARGETS) {
    try {
      const preview = await resizeToDataUrl(imageUrl);
      products.push({ key, sourceUrl, imageUrl, ...preview });
      console.log(`[TT preview] ${products.length}/${TARGETS.length} ${key}`);
    } catch (error) {
      errors.push({ key, sourceUrl, imageUrl, message: String(error?.message || error) });
      console.warn("[TT preview] failed", key, error);
    }
  }

  const payload = {
    schemaVersion: 1,
    source: location.origin,
    generatedAt: new Date().toISOString(),
    businessRules: {
      targetProductCount: TARGETS.length,
      previewsAreReviewEvidenceOnly: true,
      noColorInferenceFromFilenames: true,
      noDatabaseWrite: true,
    },
    summary: {
      targetProductCount: TARGETS.length,
      completedProductCount: products.length,
      errorCount: errors.length,
    },
    errors,
    products,
  };

  const blob = new Blob([JSON.stringify(payload)], { type: "application/json;charset=utf-8" });
  const downloadUrl = URL.createObjectURL(blob);
  const anchor = Object.assign(document.createElement("a"), {
    href: downloadUrl,
    download: `tuan-thuy-missing-color-previews-${new Date().toISOString().slice(0, 10)}.json`,
  });
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(downloadUrl);

  window.__TT_MISSING_COLOR_PREVIEW_EXPORT_RESULT__ = payload;
  window.__TT_MISSING_COLOR_PREVIEW_EXPORT_RUNNING__ = false;
  console.log("[TT preview] Finished", payload.summary);
})().catch((error) => {
  window.__TT_MISSING_COLOR_PREVIEW_EXPORT_RUNNING__ = false;
  console.error("[TT preview] Fatal", error);
});
