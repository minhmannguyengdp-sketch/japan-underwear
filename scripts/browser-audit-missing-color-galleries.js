/* Tuấn Thủy missing-color gallery audit. Paste into DevTools Console on tuanthuy.com.vn. */
(async () => {
  "use strict";

  if (window.__TT_MISSING_COLOR_GALLERY_AUDIT_RUNNING__) {
    console.warn("TT missing-color gallery audit is already running.");
    return;
  }
  window.__TT_MISSING_COLOR_GALLERY_AUDIT_RUNNING__ = true;

  const TARGETS = new Map([
    ["winking:ao-nguc:5002", "https://tuanthuy.com.vn/san-pham/ao-nguc-winking-5002/"],
    ["winking:ao-nguc:5003", "https://tuanthuy.com.vn/san-pham/ao-nguc-winking-5003/"],
    ["winking:ao-nguc:9050", "https://tuanthuy.com.vn/san-pham/ao-nguc-winking-9050/"],
    ["pensee:ao-nguc:9501", "https://tuanthuy.com.vn/san-pham/ao-nguc-pensee-9501/"],
    ["pensee:ao-nguc:9503", "https://tuanthuy.com.vn/san-pham/ao-nguc-pensee-9503/"],
    ["pensee:ao-nguc:9504", "https://tuanthuy.com.vn/san-pham/ao-nguc-pensee-9504/"],
    ["pensee:ao-nguc:9505", "https://tuanthuy.com.vn/san-pham/ao-nguc-pensee-9505/"],
    ["pensee:ao-nguc:9506", "https://tuanthuy.com.vn/san-pham/ao-nguc-pensee-9506/"],
    ["pensee:ao-nguc:9507", "https://tuanthuy.com.vn/san-pham/ao-nguc-pensee-9507/"],
    ["pensee:ao-nguc:9508", "https://tuanthuy.com.vn/san-pham/ao-nguc-pensee-9508/"],
    ["pensee:ao-nguc:9509", "https://tuanthuy.com.vn/san-pham/ao-nguc-pensee-9509/"],
    ["pensee:ao-nguc:9510", "https://tuanthuy.com.vn/san-pham/ao-nguc-pensee-9510/"],
    ["pensee:ao-nguc:9511", "https://tuanthuy.com.vn/san-pham/ao-nguc-pensee-9511/"],
    ["pensee:ao-nguc:9512", "https://tuanthuy.com.vn/san-pham/ao-nguc-pensee-9512/"],
    ["pensee:ao-nguc:9513", "https://tuanthuy.com.vn/san-pham/ao-nguc-pensee-9513/"],
    ["pensee:ao-nguc:9514", "https://tuanthuy.com.vn/san-pham/ao-nguc-pensee-9514/"],
    ["pensee:ao-nguc:9515", "https://tuanthuy.com.vn/san-pham/ao-nguc-pensse-9515/"],
    ["pensee:ao-nguc:9517", "https://tuanthuy.com.vn/san-pham/ao-nguc-pensee-95167/"],
    ["pensee:ao-nguc:9518", "https://tuanthuy.com.vn/san-pham/ao-nguc-pensee-9518/"],
    ["pensee:ao-nguc:9519", "https://tuanthuy.com.vn/san-pham/ao-nguc-pensee-9519/"],
    ["pensee:ao-nguc:9523", "https://tuanthuy.com.vn/san-pham/ao-nguc-pensee-9523/"],
    ["pensee:ao-nguc:9524", "https://tuanthuy.com.vn/san-pham/ao-nguc-pensee-9524/"],
    ["pensee:ao-nguc:9525", "https://tuanthuy.com.vn/san-pham/ao-nguc-pensee-9525/"],
    ["pensee:ao-nguc:9526", "https://tuanthuy.com.vn/san-pham/ao-nguc-pensee-9526/"],
    ["pensee:ao-nguc:9529", "https://tuanthuy.com.vn/san-pham/ao-nguc-pensee-9529/"],
    ["pensee:ao-nguc:9530", "https://tuanthuy.com.vn/san-pham/ao-nguc-pensee-9530/"],
    ["pensee:ao-nguc:9531", "https://tuanthuy.com.vn/san-pham/ao-nguc-pensee-9531/"],
    ["pensee:ao-nguc:9532", "https://tuanthuy.com.vn/san-pham/ao-nguc-pensee-9532/"],
    ["pensee:ao-nguc:9535", "https://tuanthuy.com.vn/san-pham/ao-nguc-pensee-9535/"],
    ["pensee:ao-nguc:9536", "https://tuanthuy.com.vn/san-pham/ao-nguc-pensee-9536/"],
  ]);

  const DELAY_MS = 500;
  const errors = [];
  const products = [];
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
  const uniq = (values) => [...new Set(values.filter(Boolean))];

  const COLOR_TOKENS = new Set([
    "da", "dam", "nhat", "den", "do", "tim", "trang", "hong", "xam",
    "xanh", "duong", "ngoc", "cam", "nau", "bo", "kem", "be", "ghi",
    "reu", "sen", "dat", "dong", "ruou", "man", "com", "navy", "ran",
    "soc", "hoa",
  ]);

  function fold(value) {
    return clean(value)
      .replace(/[\u0110\u0111]/g, "d")
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")
      .toLowerCase();
  }

  function slug(value) {
    return fold(value)
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  }

  function validColorLabel(value) {
    const label = clean(value).replace(/^[\-\u2013\u2014:;,/]+|[\-\u2013\u2014:;,/]+$/g, "");
    if (!label || label.length > 48) return null;
    const tokens = fold(label).split(/[^a-z0-9]+/).filter(Boolean);
    if (!tokens.length || !tokens.every((token) => COLOR_TOKENS.has(token))) return null;
    return label;
  }

  function absoluteUrl(value, base) {
    try {
      const url = new URL(value, base);
      url.hash = "";
      return /^https?:$/.test(url.protocol) ? url.href : null;
    } catch {
      return null;
    }
  }

  function flattenLd(value) {
    if (!value) return [];
    if (Array.isArray(value)) return value.flatMap(flattenLd);
    if (typeof value !== "object") return [];
    return [value, ...(Array.isArray(value["@graph"]) ? value["@graph"].flatMap(flattenLd) : [])];
  }

  function ldObjects(doc) {
    return [...doc.querySelectorAll('script[type="application/ld+json"]')].flatMap((node) => {
      try {
        return flattenLd(JSON.parse(node.textContent || "null"));
      } catch {
        return [];
      }
    });
  }

  function isType(value, expected) {
    const type = value?.["@type"];
    return Array.isArray(type) ? type.includes(expected) : type === expected;
  }

  function productLd(doc, url) {
    const candidates = ldObjects(doc).filter((item) => isType(item, "Product"));
    if (candidates.length <= 1) return candidates[0] || null;
    const target = new URL(url).pathname.replace(/\/+$/, "");
    return candidates.find((item) => {
      try {
        return new URL(item.url || item["@id"], url).pathname.replace(/\/+$/, "") === target;
      } catch {
        return false;
      }
    }) || null;
  }

  function text(doc, selectors) {
    for (const selector of selectors) {
      const value = clean(doc.querySelector(selector)?.textContent);
      if (value) return value;
    }
    return "";
  }

  function titleColors(name, modelCode) {
    const index = clean(name).indexOf(modelCode);
    if (index < 0) return [];
    const suffix = clean(name)
      .slice(index + modelCode.length)
      .replace(/^[\s\-\u2013\u2014:]+/, "")
      .trim();
    if (!suffix) return [];
    return suffix
      .split(/\s*[,/;]\s*/)
      .map(validColorLabel)
      .filter(Boolean)
      .map((name) => ({
        code: slug(name),
        name,
        evidenceType: "product-title",
        evidenceText: clean(name),
      }));
  }

  function derivativeKey(value) {
    try {
      const url = new URL(value);
      url.search = "";
      url.hash = "";
      url.pathname = url.pathname.replace(/-\d+x\d+(?=\.(?:avif|gif|jpe?g|png|webp)$)/i, "");
      return url.href;
    } catch {
      return value;
    }
  }

  function largestSrcset(value, base) {
    const candidates = String(value || "")
      .split(",")
      .map((item) => item.trim())
      .map((item) => {
        const match = item.match(/^(\S+)\s+(\d+)w$/);
        return match ? { url: absoluteUrl(match[1], base), width: Number(match[2]) } : null;
      })
      .filter(Boolean)
      .sort((left, right) => right.width - left.width);
    return candidates[0]?.url || null;
  }

  function galleryImages(doc, ld, pageUrl) {
    const rows = [];
    const add = (rawUrl, sourceType, node = null) => {
      const url = absoluteUrl(rawUrl, pageUrl);
      if (!url || !/\.(?:avif|gif|jpe?g|png|webp)(?:\?|$)/i.test(url)) return;
      rows.push({
        url,
        sourceType,
        alt: clean(node?.getAttribute?.("alt")),
        title: clean(node?.getAttribute?.("title")),
        caption: clean(node?.closest?.("figure")?.querySelector?.("figcaption")?.textContent),
      });
    };

    for (const item of Array.isArray(ld?.image) ? ld.image : [ld?.image]) {
      add(typeof item === "string" ? item : item?.url, "json-ld");
    }

    for (const img of doc.querySelectorAll(
      ".woocommerce-product-gallery img, .product-gallery img, .single-product .images img, figure.woocommerce-product-gallery__wrapper img"
    )) {
      add(
        img.getAttribute("data-large_image") ||
          largestSrcset(img.getAttribute("srcset"), pageUrl) ||
          img.currentSrc ||
          img.getAttribute("data-src") ||
          img.getAttribute("src"),
        "gallery-image",
        img,
      );
    }

    for (const anchor of doc.querySelectorAll(
      ".woocommerce-product-gallery a[href], .product-gallery a[href], .single-product .images a[href]"
    )) {
      add(anchor.getAttribute("href"), "gallery-link", anchor.querySelector("img"));
    }

    const byDerivative = new Map();
    for (const row of rows) {
      const key = derivativeKey(row.url);
      const current = byDerivative.get(key);
      if (!current || row.url.length < current.url.length) byDerivative.set(key, row);
    }
    return [...byDerivative.values()];
  }

  async function fetchDoc(url) {
    const response = await fetch(url, {
      credentials: "include",
      headers: { Accept: "text/html,application/xhtml+xml" },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return new DOMParser().parseFromString(await response.text(), "text/html");
  }

  for (const [key, sourceUrl] of TARGETS) {
    try {
      const doc = await fetchDoc(sourceUrl);
      const ld = productLd(doc, sourceUrl) || {};
      const modelCode = key.split(":").at(-1);
      const name = clean(ld.name) || text(doc, [
        "h1.product_title",
        "h1.product-title",
        "[itemprop='name']",
        ".single-product h1",
      ]);
      const images = galleryImages(doc, ld, sourceUrl);
      products.push({
        key,
        sourceUrl,
        name,
        explicitTitleColors: titleColors(name, modelCode),
        images,
        imageCount: images.length,
        scrapedAt: new Date().toISOString(),
      });
      console.log(`[TT gallery] ${products.length}/${TARGETS.size} ${key}: ${images.length} images`);
    } catch (error) {
      errors.push({ key, sourceUrl, message: String(error?.message || error) });
      console.warn("[TT gallery] failed", key, sourceUrl, error);
    }
    await sleep(DELAY_MS);
  }

  const payload = {
    schemaVersion: 1,
    source: location.origin,
    generatedAt: new Date().toISOString(),
    businessRules: {
      targetProductCount: TARGETS.size,
      productIdentity: "brand + category + model",
      imagesAreReviewEvidenceOnly: true,
      noColorInferenceFromFilenames: true,
      noDatabaseWrite: true,
    },
    summary: {
      targetProductCount: TARGETS.size,
      completedProductCount: products.length,
      productsWithImages: products.filter((product) => product.images.length > 0).length,
      imageCount: products.reduce((sum, product) => sum + product.images.length, 0),
      errorCount: errors.length,
    },
    errors,
    products,
  };

  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: "application/json;charset=utf-8",
  });
  const downloadUrl = URL.createObjectURL(blob);
  const anchor = Object.assign(document.createElement("a"), {
    href: downloadUrl,
    download: `tuan-thuy-missing-color-galleries-${new Date().toISOString().slice(0, 10)}.json`,
  });
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(downloadUrl);

  window.__TT_MISSING_COLOR_GALLERY_AUDIT_RESULT__ = payload;
  window.__TT_MISSING_COLOR_GALLERY_AUDIT_RUNNING__ = false;
  console.log("[TT gallery] Finished", payload);
})().catch((error) => {
  window.__TT_MISSING_COLOR_GALLERY_AUDIT_RUNNING__ = false;
  console.error("[TT gallery] Fatal", error);
});
