/* Tuấn Thủy color audit — paste into DevTools Console on tuanthuy.com.vn */
(async () => {
  "use strict";

  if (window.__TT_COLOR_AUDIT_RUNNING__) {
    console.warn("TT color audit is already running.");
    return;
  }
  window.__TT_COLOR_AUDIT_RUNNING__ = true;

  const cfg = {
    startUrl: location.href,
    delayMs: 700,
    maxListingPages: 250,
    maxProducts: 5000,
    maxDepth: 5,
    productHints: ["/san-pham/", "/product/", "/products/"],
    listingHints: [
      "/danh-muc-san-pham/",
      "/product-category/",
      "/collections/",
      "/shop/",
      "/cua-hang/",
      "/page/",
    ],
    ...(window.__TT_COLOR_AUDIT_CONFIG__ || {}),
  };

  const listingSeen = new Set();
  const productSeen = new Set();
  const products = [];
  const errors = [];
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
  const uniq = (values) => [...new Set(values.map(clean).filter(Boolean))];

  const COLOR_CONTEXT = /(m[aà]u(?:\s*s[aắ]c)?|color|colour|mau-sac|mau_sac|pa_mau)/i;
  const IGNORE_OPTION = /(chọn|select|choose|vui lòng|mặc định|default)/i;
  const COLOR_TOKENS = new Set([
    "da", "dam", "nhat", "den", "do", "tim", "trang", "hong", "xam",
    "xanh", "duong", "ngoc", "cam", "nau", "bo", "kem", "be", "ghi", "reu",
    "sen", "dat", "dong", "ruou", "man", "com", "navy", "ran", "soc", "hoa",
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
    const label = clean(value).replace(/^[\-–—:;,/]+|[\-–—:;,/]+$/g, "");
    if (!label || label.length > 48 || IGNORE_OPTION.test(label)) return null;
    const tokens = fold(label).split(/[^a-z0-9]+/).filter(Boolean);
    if (!tokens.length || !tokens.every((token) => COLOR_TOKENS.has(token))) return null;
    return label;
  }

  function sameOriginUrl(value, base = location.href) {
    try {
      const url = new URL(value, base);
      url.hash = "";
      return url.origin === location.origin ? url.href : null;
    } catch {
      return null;
    }
  }

  function text(doc, selectors) {
    for (const selector of selectors) {
      const value = clean(doc.querySelector(selector)?.textContent);
      if (value) return value;
    }
    return "";
  }

  function attr(doc, selectors, name) {
    for (const selector of selectors) {
      const value = clean(doc.querySelector(selector)?.getAttribute(name));
      if (value) return value;
    }
    return "";
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
    return (
      candidates.find((item) => {
        try {
          return new URL(item.url || item["@id"], url).pathname.replace(/\/+$/, "") === target;
        } catch {
          return false;
        }
      }) || null
    );
  }

  function normalizeBrand(name, structuredBrand) {
    const evidence = fold(`${structuredBrand || ""} ${name || ""}`);
    if (/pensee|pensees|pensse/.test(evidence)) return "pensee";
    if (/winking/.test(evidence)) return "winking";
    return null;
  }

  function inferCategory(name) {
    const evidence = fold(name);
    if (/ao nguc/.test(evidence)) return "ao-nguc";
    if (/quan lot/.test(evidence)) return "quan-lot";
    if (/quan gen/.test(evidence)) return "quan-gen";
    return null;
  }

  function resolveModel(name, sourceKey, sku) {
    const values = `${name || ""} ${sku || ""} ${sourceKey || ""}`;
    const explicitName = [...clean(name).matchAll(/(?:^|\D)([5789]\d{3})(?:\D|$)/g)].map(
      (match) => match[1],
    );
    if (uniq(explicitName).length === 1) return uniq(explicitName)[0];
    const candidates = [...values.matchAll(/(?:^|\D)([5789]\d{3})(?:\D|$)/g)].map(
      (match) => match[1],
    );
    return uniq(candidates).length === 1 ? uniq(candidates)[0] : null;
  }

  function titleColors(name, modelCode) {
    if (!modelCode) return [];
    const index = clean(name).indexOf(modelCode);
    if (index < 0) return [];
    const suffix = clean(name)
      .slice(index + modelCode.length)
      .replace(/^[\s\-–—:]+/, "")
      .trim();
    if (!suffix) return [];
    return suffix
      .split(/\s*[,/;]\s*/)
      .map(validColorLabel)
      .filter(Boolean)
      .map((label) => ({ name: label, evidenceType: "product-title", evidenceText: name }));
  }

  function structuredColors(doc) {
    const found = [];
    for (const select of doc.querySelectorAll("select")) {
      const context = clean(
        `${select.name} ${select.id} ${select.getAttribute("aria-label")} ${select.closest("[data-attribute_name]")?.getAttribute("data-attribute_name")}`,
      );
      if (!COLOR_CONTEXT.test(context)) continue;
      for (const option of select.options) {
        if (!option.value || option.disabled) continue;
        const label = validColorLabel(option.textContent || option.value);
        if (label) {
          found.push({ name: label, evidenceType: "page-control", evidenceText: context });
        }
      }
    }

    for (const node of doc.querySelectorAll("[data-value], [data-attribute_name], .variable-item, .swatch")) {
      const context = clean(
        `${node.getAttribute("data-attribute_name")} ${node.closest("[data-attribute_name]")?.getAttribute("data-attribute_name")} ${node.parentElement?.className}`,
      );
      if (!COLOR_CONTEXT.test(context)) continue;
      const label = validColorLabel(
        node.getAttribute("data-value") || node.getAttribute("title") || node.textContent,
      );
      if (label) found.push({ name: label, evidenceType: "page-swatch", evidenceText: context });
    }

    for (const form of doc.querySelectorAll('form.variations_form[data-product_variations]')) {
      try {
        const rows = JSON.parse(form.getAttribute("data-product_variations") || "[]");
        for (const row of rows) {
          for (const [key, rawValue] of Object.entries(row.attributes || {})) {
            if (!COLOR_CONTEXT.test(key)) continue;
            const label = validColorLabel(rawValue);
            if (label) {
              found.push({ name: label, evidenceType: "woo-variation", evidenceText: key });
            }
          }
        }
      } catch (error) {
        errors.push({
          stage: "variation-json",
          url: location.href,
          message: String(error?.message || error),
        });
      }
    }
    return found;
  }

  function descriptionColors(rawText) {
    const found = [];
    const source = String(rawText || "")
      .replace(/[▪▫•●◾◽➖]+/g, "\n")
      .replace(/\s+/g, " ");
    const expression = /(?:m[aà]u(?:\s*s[aắ]c)?|color)\s*[:：-]\s*([^\n]{1,180})/gi;
    for (const match of source.matchAll(expression)) {
      const segment = clean(
        String(match[1] || "").split(
          /(?:size|k[ií]ch\s*c[ỡơ]|c[ỡơ]|cup|gi[aá]|sku|chất liệu|website|hotline|liên hệ)\s*[:：-]?/i,
        )[0],
      );
      if (!segment) continue;
      for (const part of segment.split(/\s*(?:,|;|\/|\||\bvà\b)\s*/i)) {
        const label = validColorLabel(part);
        if (label) {
          found.push({ name: label, evidenceType: "explicit-description", evidenceText: segment });
        }
      }
    }
    return found;
  }

  function uniqueColorEvidence(rows) {
    const byCode = new Map();
    for (const row of rows) {
      const code = slug(row.name);
      if (!code) continue;
      const current = byCode.get(code) || {
        code,
        name: clean(row.name),
        evidenceTypes: [],
        evidenceTexts: [],
      };
      current.evidenceTypes.push(row.evidenceType);
      current.evidenceTexts.push(row.evidenceText);
      byCode.set(code, current);
    }
    return [...byCode.values()]
      .map((row) => ({
        ...row,
        evidenceTypes: uniq(row.evidenceTypes),
        evidenceTexts: uniq(row.evidenceTexts),
      }))
      .sort((left, right) => left.name.localeCompare(right.name, "vi"));
  }

  function isProductPage(doc, url) {
    const bodyClass = clean(doc.body?.className);
    if (/\b(single-product|product-template-default)\b/i.test(bodyClass)) return true;
    if (doc.querySelector("form.variations_form, form.cart input[name='add-to-cart'], .single-product .summary")) return true;
    const ogType = attr(doc, ['meta[property="og:type"]'], "content").toLowerCase();
    const hasTitle = Boolean(doc.querySelector("h1.product_title, h1.product-title, .single-product h1"));
    const hasSummary = Boolean(doc.querySelector(".summary .price, .product-summary .price, [itemprop='price']"));
    if (ogType === "product" && hasTitle && hasSummary) return true;
    const pathname = new URL(url).pathname.toLowerCase();
    return cfg.productHints.some((hint) => pathname.includes(hint)) && hasTitle;
  }

  function extractProduct(doc, url) {
    const canonicalUrl = sameOriginUrl(attr(doc, ['link[rel="canonical"]'], "href"), url) || url;
    const ld = productLd(doc, canonicalUrl) || {};
    const path = new URL(canonicalUrl).pathname.split("/").filter(Boolean);
    const name = clean(ld.name) || text(doc, ["h1.product_title", "h1.product-title", "[itemprop='name']", ".single-product h1"]);
    const sku = clean(ld.sku ?? ld.mpn) || text(doc, [".sku", "[itemprop='sku']"]);
    const sourceKey = path.at(-1) || path.at(-2) || "";
    const structuredBrand = clean(typeof ld.brand === "string" ? ld.brand : ld.brand?.name);
    const brand = normalizeBrand(name, structuredBrand);
    const category = inferCategory(name);
    const modelCode = resolveModel(name, sourceKey, sku);
    const descriptionRoot = doc.querySelector(
      "#tab-description, .woocommerce-Tabs-panel--description, .woocommerce-product-details__short-description, .product-description, [itemprop='description']",
    );
    const description = clean(ld.description) || clean(descriptionRoot?.textContent);
    const colors = uniqueColorEvidence([
      ...titleColors(name, modelCode),
      ...structuredColors(doc),
      ...descriptionColors(description),
    ]);
    const key = brand && category && modelCode ? `${brand}:${category}:${modelCode}` : null;
    return {
      sourceUrl: canonicalUrl,
      sourceKey,
      key,
      brand,
      category,
      modelCode,
      name,
      sku,
      colors,
      scrapedAt: new Date().toISOString(),
    };
  }

  function links(doc, base, selectors) {
    return uniq(
      [...doc.querySelectorAll(selectors)].map((node) => sameOriginUrl(node.getAttribute("href"), base)),
    );
  }

  function productLinks(doc, base) {
    const selectors =
      'a.woocommerce-LoopProduct-link[href],a.woocommerce-loop-product__link[href],.wc-block-grid__product-link[href],.products .product a[href],[itemtype*="schema.org/Product"] a[href],.product-item a[href],.product-card a[href],.card-product a[href],a[href*="/san-pham/"],a[href*="/product/"],a[href*="/products/"]';
    return links(doc, base, selectors).filter((url) => {
      if (!url) return false;
      const parsed = new URL(url);
      if (parsed.pathname === "/" && !parsed.search) return false;
      return !/\/product-category\//i.test(parsed.pathname);
    });
  }

  function listingLinks(doc, base) {
    const selectors =
      '.pagination a[href],.woocommerce-pagination a[href],a.next[href],.product-categories a[href],.category-menu a[href],a[href*="/product-category/"],a[href*="/danh-muc-san-pham/"],a[href*="/collections/"],a[href*="/shop/"]';
    return links(doc, base, selectors).filter((url) => {
      const parsed = new URL(url);
      return (
        cfg.listingHints.some((hint) => parsed.pathname.toLowerCase().includes(hint)) ||
        /[?&](page|paged|product-page)=\d+/i.test(parsed.search)
      );
    });
  }

  async function fetchDoc(url) {
    const response = await fetch(url, {
      credentials: "include",
      headers: { Accept: "text/html,application/xhtml+xml" },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return new DOMParser().parseFromString(await response.text(), "text/html");
  }

  async function scrapeProduct(url, providedDoc) {
    if (productSeen.has(url) || products.length >= cfg.maxProducts) return;
    productSeen.add(url);
    try {
      const doc = providedDoc || (await fetchDoc(url));
      if (!isProductPage(doc, url)) return;
      const product = extractProduct(doc, url);
      if (!product.name || !product.sourceKey) throw new Error("Missing product name or canonical source key");
      products.push(product);
      console.log(`[TT color] ${products.length}: ${product.name}`, product.colors);
    } catch (error) {
      errors.push({ stage: "product", url, message: String(error?.message || error) });
      console.warn("[TT color] Product failed", url, error);
    }
    await sleep(cfg.delayMs);
  }

  const startUrl = sameOriginUrl(cfg.startUrl, location.href) || location.href;
  const queue = [{ url: startUrl, depth: 0, doc: startUrl === location.href ? document : null }];
  while (queue.length && listingSeen.size < cfg.maxListingPages) {
    const current = queue.shift();
    if (listingSeen.has(current.url) || current.depth > cfg.maxDepth) continue;
    listingSeen.add(current.url);
    try {
      const doc = current.doc || (await fetchDoc(current.url));
      console.log(`[TT color] Visit ${listingSeen.size}: ${current.url}`);
      if (isProductPage(doc, current.url)) {
        await scrapeProduct(current.url, doc);
      } else {
        for (const url of productLinks(doc, current.url)) await scrapeProduct(url);
        for (const url of listingLinks(doc, current.url)) {
          if (!listingSeen.has(url)) queue.push({ url, depth: current.depth + 1, doc: null });
        }
      }
    } catch (error) {
      errors.push({ stage: "listing", url: current.url, message: String(error?.message || error) });
      console.warn("[TT color] Listing failed", current.url, error);
    }
    await sleep(cfg.delayMs);
  }

  const sortedProducts = products.sort(
    (left, right) =>
      String(left.key).localeCompare(String(right.key), "vi") ||
      left.sourceUrl.localeCompare(right.sourceUrl, "vi"),
  );
  const payload = {
    schemaVersion: 1,
    source: location.origin,
    generatedAt: new Date().toISOString(),
    businessRules: {
      productIdentity: "brand + category + model",
      explicitWebsiteColorsOnly: true,
      noColorInferenceFromImagesOrFilenames: true,
      noDatabaseWrite: true,
    },
    summary: {
      productPageCount: sortedProducts.length,
      listingPagesVisited: listingSeen.size,
      productsWithExplicitColors: sortedProducts.filter((product) => product.colors.length > 0).length,
      explicitColorCount: sortedProducts.reduce((sum, product) => sum + product.colors.length, 0),
      unresolvedIdentityCount: sortedProducts.filter((product) => !product.key).length,
      errorCount: errors.length,
    },
    errors,
    products: sortedProducts,
  };

  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: "application/json;charset=utf-8",
  });
  const downloadUrl = URL.createObjectURL(blob);
  const anchor = Object.assign(document.createElement("a"), {
    href: downloadUrl,
    download: `tuan-thuy-color-audit-${new Date().toISOString().slice(0, 10)}.json`,
  });
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(downloadUrl);
  window.__TT_COLOR_AUDIT_RESULT__ = payload;
  window.__TT_COLOR_AUDIT_RUNNING__ = false;
  console.log("[TT color] Finished", payload);
})().catch((error) => {
  window.__TT_COLOR_AUDIT_RUNNING__ = false;
  console.error("[TT color] Fatal", error);
});
