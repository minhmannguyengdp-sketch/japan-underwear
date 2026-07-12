/* Tuấn Thủy catalog audit — paste into DevTools Console on tuanthuy.com.vn */
(async () => {
  'use strict';

  if (window.__TT_SCRAPER_RUNNING__) return console.warn('TT scraper is already running.');
  window.__TT_SCRAPER_RUNNING__ = true;

  const cfg = {
    startUrl: location.href,
    delayMs: 700,
    maxListingPages: 250,
    maxProducts: 5000,
    maxDepth: 5,
    productHints: ['/san-pham/', '/product/', '/products/'],
    listingHints: ['/danh-muc-san-pham/', '/product-category/', '/collections/', '/shop/', '/cua-hang/', '/page/'],
    ...(window.__TT_SCRAPER_CONFIG__ || {}),
  };

  const listingSeen = new Set();
  const productSeen = new Set();
  const products = [];
  const errors = [];
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const clean = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
  const uniq = (values) => [...new Set(values.map(clean).filter(Boolean))];

  const COLOR_WORDS = /(m[aà]u|color|colour|mau-sac|mau_sac|pa_mau)/i;
  const SIZE_WORDS = /(^|\b)(size|k[ií]ch c[ỡơ]|k[ií]ch thước|c[ỡơ]|sz|vòng lưng|lưng)(\b|$)/i;
  const CUP_WORDS = /(^|\b)(cup|cúp|bầu ngực)(\b|$)/i;
  const IGNORE_OPTION = /(chọn|select|choose|vui lòng)/i;
  const BOILERPLATE = /(đổi trả|giao hàng|thanh toán|hotline|liên hệ|bảo quản|hướng dẫn giặt|chính sách|cam kết|copyright|tuanthuy\.com|@tuanthuy|\b0\d{8,10}\b)/i;
  const FEATURE_WORDS = /(chất liệu|cotton|ren|mút|gọng|cúp|cup|bản lưng|dây áo|nâng|đỡ|định hình|co giãn|thoáng|ôm|mềm|không đường may|phom|form|thiết kế|tháo rời|điều chỉnh)/i;
  const IMAGE_EXT = /\.(?:avif|gif|jpe?g|png|webp)$/i;

  function sameOriginUrl(value, base = location.href) {
    try {
      const url = new URL(value, base);
      url.hash = '';
      return url.origin === location.origin ? url.href : null;
    } catch { return null; }
  }

  function assetUrl(value, base = location.href) {
    try {
      const url = new URL(value, base);
      url.hash = '';
      return /^https?:$/.test(url.protocol) ? url.href : null;
    } catch { return null; }
  }

  function productImageUrl(value, base = location.href) {
    const resolved = assetUrl(value, base);
    if (!resolved) return null;
    const url = new URL(resolved);
    if (!IMAGE_EXT.test(url.pathname)) return null;
    return url.href;
  }

  function money(value) {
    if (typeof value === 'number' && Number.isFinite(value)) return Math.round(value);
    const digits = clean(value).replace(/[^\d]/g, '');
    return digits ? Number(digits) : null;
  }

  function text(doc, selectors) {
    for (const selector of selectors) {
      const value = clean(doc.querySelector(selector)?.textContent);
      if (value) return value;
    }
    return '';
  }

  function attr(doc, selectors, name) {
    for (const selector of selectors) {
      const value = clean(doc.querySelector(selector)?.getAttribute(name));
      if (value) return value;
    }
    return '';
  }

  function flattenLd(value) {
    if (!value) return [];
    if (Array.isArray(value)) return value.flatMap(flattenLd);
    if (typeof value !== 'object') return [];
    return [value, ...(Array.isArray(value['@graph']) ? value['@graph'].flatMap(flattenLd) : [])];
  }

  function ldObjects(doc) {
    return [...doc.querySelectorAll('script[type="application/ld+json"]')].flatMap((node) => {
      try { return flattenLd(JSON.parse(node.textContent || 'null')); }
      catch { return []; }
    });
  }

  function isType(value, expected) {
    const type = value?.['@type'];
    return Array.isArray(type) ? type.includes(expected) : type === expected;
  }

  function productLd(doc, url) {
    const candidates = ldObjects(doc).filter((item) => isType(item, 'Product'));
    if (candidates.length <= 1) return candidates[0] || null;
    const target = new URL(url).pathname.replace(/\/+$/, '');
    return candidates.find((item) => {
      try {
        return new URL(item.url || item['@id'], url).pathname.replace(/\/+$/, '') === target;
      } catch { return false; }
    }) || null;
  }

  function offersOf(value) {
    if (!value) return [];
    if (Array.isArray(value)) return value;
    return Array.isArray(value.offers) ? value.offers : [value];
  }

  function optionName(value) {
    return clean(value)
      .replace(/^attribute_/, '')
      .replace(/^pa_/, '')
      .replace(/[-_]+/g, ' ');
  }

  function classifyOption(name) {
    const value = optionName(name);
    if (COLOR_WORDS.test(value)) return 'color';
    if (CUP_WORDS.test(value)) return 'cup';
    if (SIZE_WORDS.test(value)) return 'size';
    return 'other';
  }

  function normalizeCup(value) {
    const raw = clean(value).toUpperCase().replace(/^CUP\s*/i, '');
    return raw || null;
  }

  function normalizeSize(value) {
    const raw = clean(value)
      .toUpperCase()
      .replace(/^SIZE\s*/i, '')
      .replace(/^XXL$/, '2XL')
      .replace(/^XXXL$/, '3XL')
      .replace(/^XXXXL$/, '4XL');
    return raw || null;
  }

  function splitCombinedSizeCup(value) {
    const raw = clean(value).toUpperCase().replace(/\s+/g, '');
    const match = raw.match(/^(\d{2,3}|XS|S|M|L|XL|XXL|XXXL|XXXXL|[2-6]X(?:L)?)[-\/]?([A-H])$/i);
    if (!match) return { size: normalizeSize(value), cup: null };
    return { size: normalizeSize(match[1]), cup: normalizeCup(match[2]) };
  }

  function rawWooVariants(doc, pageUrl) {
    const forms = [...doc.querySelectorAll('form.variations_form[data-product_variations]')];
    const rows = [];
    for (const form of forms) {
      try {
        const parsed = JSON.parse(form.getAttribute('data-product_variations') || '[]');
        for (const row of parsed) {
          rows.push({
            externalId: String(row.variation_id || ''),
            sku: clean(row.sku),
            rawOptions: Object.fromEntries(Object.entries(row.attributes || {})
              .map(([key, value]) => [optionName(key), clean(value)])
              .filter(([key, value]) => key && value)),
            price: money(row.display_price ?? row.price_html),
            compareAtPrice: money(row.display_regular_price),
            inStock: Boolean(row.is_in_stock ?? row.is_purchasable),
            image: productImageUrl(row.image?.full_src ?? row.image?.src, pageUrl),
            evidence: 'woo-variation',
          });
        }
      } catch (error) {
        errors.push({ stage: 'variation-json', url: pageUrl, message: String(error?.message || error) });
      }
    }
    return rows;
  }

  function attributeOptions(doc) {
    const result = { colors: [], sizes: [], cups: [], other: {} };
    for (const select of doc.querySelectorAll('select')) {
      const name = optionName(`${select.name} ${select.id} ${select.getAttribute('aria-label')}`);
      const type = classifyOption(name);
      const values = [...select.options]
        .filter((option) => option.value && !option.disabled && !IGNORE_OPTION.test(clean(option.textContent)))
        .map((option) => clean(option.textContent || option.value));
      if (type === 'color') result.colors.push(...values);
      else if (type === 'size') result.sizes.push(...values);
      else if (type === 'cup') result.cups.push(...values);
      else if (values.length) result.other[name || 'unknown'] = uniq([...(result.other[name] || []), ...values]);
    }

    for (const node of doc.querySelectorAll('[data-value], [data-attribute_name], .variable-item, .swatch')) {
      const context = clean(`${node.getAttribute('data-attribute_name')} ${node.closest('[data-attribute_name]')?.getAttribute('data-attribute_name')} ${node.parentElement?.className}`);
      const value = clean(node.getAttribute('data-value') || node.getAttribute('title') || node.textContent);
      if (!value || IGNORE_OPTION.test(value)) continue;
      const type = classifyOption(context);
      if (type === 'color') result.colors.push(value);
      else if (type === 'size') result.sizes.push(value);
      else if (type === 'cup') result.cups.push(value);
    }

    result.colors = uniq(result.colors);
    result.sizes = uniq(result.sizes);
    result.cups = uniq(result.cups);
    return result;
  }

  function parseVariationOptions(rawOptions) {
    const parsed = { size: null, cup: null, colors: [], other: {} };
    for (const [name, rawValue] of Object.entries(rawOptions || {})) {
      const type = classifyOption(name);
      if (type === 'color') parsed.colors.push(rawValue);
      else if (type === 'cup') parsed.cup = normalizeCup(rawValue);
      else if (type === 'size') {
        const combined = splitCombinedSizeCup(rawValue);
        parsed.size = combined.size;
        parsed.cup = parsed.cup || combined.cup;
      } else {
        const combined = splitCombinedSizeCup(rawValue);
        if (!parsed.size && combined.cup) {
          parsed.size = combined.size;
          parsed.cup = parsed.cup || combined.cup;
        } else {
          parsed.other[name] = rawValue;
        }
      }
    }
    parsed.colors = uniq(parsed.colors);
    return parsed;
  }

  function pageControlRows(attributes, basePrice) {
    const rows = [];
    for (const sizeValue of attributes.sizes) {
      const combined = splitCombinedSizeCup(sizeValue);
      if (combined.cup) {
        rows.push({
          externalId: '', sku: '', rawOptions: {}, size: combined.size, cup: combined.cup,
          colors: [], price: basePrice, compareAtPrice: null, inStock: true, image: null,
          evidence: 'combined-size-cup-page-control',
        });
      } else if (attributes.cups.length === 0) {
        rows.push({
          externalId: '', sku: '', rawOptions: {}, size: combined.size, cup: null,
          colors: [], price: basePrice, compareAtPrice: null, inStock: true, image: null,
          evidence: 'size-only-page-control',
        });
      }
    }
    return rows;
  }

  function descriptionSizeCupRows(rawText, basePrice) {
    const rows = [];
    const evidenceSegments = [];
    const expression = /(?:^|\s)(?:size|k[ií]ch\s*c[ỡơ]|c[ỡơ])\s*[:：-]\s*([\s\S]{1,160}?)(?=\s*(?:gi[aá]|m[aà]u|hotline|☎|💻|📧|https?:|www\.|$))/gi;
    for (const match of String(rawText || '').matchAll(expression)) {
      const segment = clean(match[1]);
      if (!segment) continue;
      evidenceSegments.push(segment);
      const combined = [...segment.matchAll(/\b(\d{2,3})\s*[-\/]?\s*([A-H])\b/gi)];
      if (combined.length) {
        for (const item of combined) {
          const size = normalizeSize(item[1]);
          const cup = normalizeCup(item[2]);
          rows.push({
            externalId: '', sku: '', rawOptions: {}, size, cup, colors: [],
            price: basePrice, compareAtPrice: null, inStock: true, image: null,
            evidence: 'description-explicit-size-cup-list', sourceText: segment,
          });
        }
        continue;
      }
      for (const item of segment.matchAll(/\b(XS|S|M|L|XL|XXL|XXXL|XXXXL|[2-6]X(?:L)?)\b/gi)) {
        rows.push({
          externalId: '', sku: '', rawOptions: {}, size: normalizeSize(item[1]), cup: null,
          colors: [], price: basePrice, compareAtPrice: null, inStock: true, image: null,
          evidence: 'description-explicit-size-list', sourceText: segment,
        });
      }
    }
    return { rows, evidenceSegments: uniq(evidenceSegments) };
  }

  function partitionRawVariants(rawRows) {
    const orderable = [];
    const ignoredColorOnly = [];
    const unmapped = [];
    for (const row of rawRows) {
      const parsed = parseVariationOptions(row.rawOptions);
      if (parsed.size || parsed.cup) orderable.push(row);
      else if (parsed.colors.length && Object.keys(parsed.other).length === 0) ignoredColorOnly.push(row);
      else unmapped.push(row);
    }
    return { orderable, ignoredColorOnly, unmapped };
  }

  function groupOrderableVariants(rawRows, basePrice) {
    const groups = new Map();
    const unmappedRows = [];
    const ignoredColorOnlyRows = [];
    for (const row of rawRows) {
      const parsed = row.size !== undefined
        ? { size: row.size, cup: row.cup, colors: row.colors || [], other: {} }
        : parseVariationOptions(row.rawOptions);
      if (!parsed.size && !parsed.cup) {
        if (parsed.colors.length && Object.keys(parsed.other).length === 0) ignoredColorOnlyRows.push(row);
        else unmappedRows.push(row);
        continue;
      }
      const size = parsed.size || 'NO_SIZE';
      const cup = parsed.cup || null;
      const key = `${size}::${cup || ''}`;
      const current = groups.get(key) || {
        variantKey: key,
        size,
        cup,
        label: cup ? `${size}${cup}` : size,
        sourceVariantIds: [],
        sourceSkus: [],
        sourceColors: [],
        priceCandidates: [],
        compareAtPriceCandidates: [],
        inStockStates: [],
        evidence: [],
        rawRows: [],
      };
      current.sourceVariantIds.push(row.externalId);
      current.sourceSkus.push(row.sku);
      current.sourceColors.push(...parsed.colors);
      current.evidence.push(row.evidence || 'woo-variation');
      if (row.price != null) current.priceCandidates.push(row.price);
      else if (basePrice != null) current.priceCandidates.push(basePrice);
      if (row.compareAtPrice != null) current.compareAtPriceCandidates.push(row.compareAtPrice);
      current.inStockStates.push(Boolean(row.inStock));
      current.rawRows.push({
        externalId: row.externalId,
        sku: row.sku,
        rawOptions: row.rawOptions || {},
        price: row.price,
        inStock: row.inStock,
        evidence: row.evidence || 'woo-variation',
        sourceText: row.sourceText || null,
      });
      groups.set(key, current);
    }

    const variants = [...groups.values()].map((group) => {
      const prices = [...new Set(group.priceCandidates)];
      const comparePrices = [...new Set(group.compareAtPriceCandidates)];
      const stockStates = [...new Set(group.inStockStates)];
      return {
        variantKey: group.variantKey,
        size: group.size,
        cup: group.cup,
        label: group.label,
        sku: uniq(group.sourceSkus).length === 1 ? uniq(group.sourceSkus)[0] : null,
        sourceVariantIds: uniq(group.sourceVariantIds),
        sourceSkus: uniq(group.sourceSkus),
        sourceColors: uniq(group.sourceColors),
        evidence: uniq(group.evidence),
        price: prices.length === 1 ? prices[0] : null,
        priceCandidates: prices,
        compareAtPrice: comparePrices.length === 1 ? comparePrices[0] : null,
        inStock: group.inStockStates.some(Boolean),
        stockStates,
        priceConsistent: prices.length <= 1,
        stockConsistent: stockStates.length <= 1,
        sourceRowCount: group.rawRows.length,
        rawRows: group.rawRows,
      };
    }).sort((a, b) => a.label.localeCompare(b.label, 'vi', { numeric: true }));

    return { variants, unmappedRows, ignoredColorOnlyRows };
  }

  function descriptionPriceCandidates(rawText) {
    const values = [];
    for (const match of String(rawText || '').matchAll(/(?:gi[aá]|price)\s*[:：-]?\s*([\d.\s]{4,15})\s*(?:đ|vnđ|vnd)?/gi)) {
      const value = money(match[1]);
      if (value != null) values.push(value);
    }
    return [...new Set(values)];
  }

  function descriptionAudit(doc, ldDescription) {
    const root = doc.querySelector('#tab-description, .woocommerce-Tabs-panel--description, .woocommerce-product-details__short-description, .product-description, [itemprop="description"]');
    const rawText = clean(ldDescription) || clean(root?.textContent);
    const nodeTexts = root ? [...root.querySelectorAll('li, p, h2, h3, h4')].map((node) => clean(node.textContent)) : [];
    const splitTexts = String(rawText || '')
      .replace(/[-_]{5,}/g, '\n')
      .replace(/[▪▫•●◾◽➖]+/g, '\n')
      .replace(/(?:chất liệu và ưu điểm|giới thiệu chung)\s*:/gi, '\n')
      .split(/\n+|[.!?]\s+/)
      .map(clean);
    const featureCandidates = uniq([...nodeTexts, ...splitTexts]
      .filter((value) => value.length >= 12 && value.length <= 240)
      .filter((value) => FEATURE_WORDS.test(value))
      .filter((value) => !BOILERPLATE.test(value))
      .filter((value) => !/^(m[aã]|size|gi[aá]|sku|website|email)\s*[:：-]/i.test(value)))
      .slice(0, 16);
    return {
      rawText,
      featureCandidates,
      priceCandidates: descriptionPriceCandidates(rawText),
    };
  }

  function modelCandidates(...values) {
    const found = [];
    for (const value of values) {
      for (const match of clean(value).matchAll(/(?:AL|QL|QG|QI|WK|TT)?['’\s-]*([5789]\d{3})(?:-([A-Z0-9]+))?/gi)) {
        found.push(match[1]);
      }
    }
    return uniq(found);
  }

  function imageDerivativeKey(url) {
    const parsed = new URL(url);
    parsed.search = '';
    parsed.hash = '';
    parsed.pathname = parsed.pathname.replace(/-\d+x\d+(?=\.(?:avif|gif|jpe?g|png|webp)$)/i, '');
    return parsed.href;
  }

  function imageResolutionScore(url) {
    const match = new URL(url).pathname.match(/-(\d+)x(\d+)(?=\.(?:avif|gif|jpe?g|png|webp)$)/i);
    return match ? Number(match[1]) * Number(match[2]) : Number.MAX_SAFE_INTEGER;
  }

  function filterProductImages(urls, models) {
    const byDerivative = new Map();
    for (const value of urls.filter(Boolean)) {
      let parsed;
      try { parsed = new URL(value); } catch { continue; }
      const filename = decodeURIComponent(parsed.pathname.split('/').pop() || '');
      const codes = [...filename.matchAll(/(?:^|\D)([5789]\d{3})(?:\D|$)/g)].map((match) => match[1]);
      if (codes.length && models.length && !codes.some((code) => models.includes(code))) continue;
      const key = imageDerivativeKey(value);
      const current = byDerivative.get(key);
      if (!current || imageResolutionScore(value) > imageResolutionScore(current)) byDerivative.set(key, value);
    }
    return [...byDerivative.values()];
  }

  function productImages(doc, ld, pageUrl, models) {
    const candidates = [];
    for (const item of (Array.isArray(ld.image) ? ld.image : [ld.image])) {
      candidates.push(productImageUrl(typeof item === 'string' ? item : item?.url, pageUrl));
    }
    for (const img of doc.querySelectorAll('.woocommerce-product-gallery img, .product-gallery img, .single-product .images img, figure.woocommerce-product-gallery__wrapper img')) {
      candidates.push(productImageUrl(img.getAttribute('data-large_image') || img.currentSrc || img.src || img.getAttribute('data-src'), pageUrl));
    }
    for (const anchor of doc.querySelectorAll('.woocommerce-product-gallery a[href], .product-gallery a[href], .single-product .images a[href]')) {
      candidates.push(productImageUrl(anchor.getAttribute('href'), pageUrl));
    }
    return filterProductImages(candidates, models);
  }

  function isProductPage(doc, url) {
    const bodyClass = clean(doc.body?.className);
    if (/\b(single-product|product-template-default)\b/i.test(bodyClass)) return true;
    if (doc.querySelector('form.variations_form, form.cart input[name="add-to-cart"], .single-product .summary')) return true;

    const ogType = attr(doc, ['meta[property="og:type"]'], 'content').toLowerCase();
    const hasTitle = Boolean(doc.querySelector('h1.product_title, h1.product-title, .single-product h1'));
    const hasProductSummary = Boolean(doc.querySelector('.summary .price, .product-summary .price, [itemprop="price"]'));
    if (ogType === 'product' && hasTitle && hasProductSummary) return true;

    let pathname = '';
    try { pathname = new URL(url).pathname.toLowerCase(); } catch { return false; }
    const hintedPath = cfg.productHints.some((hint) => pathname.includes(hint));
    return hintedPath && hasTitle && hasProductSummary;
  }

  function extractProduct(doc, url) {
    const canonicalUrl = sameOriginUrl(attr(doc, ['link[rel="canonical"]'], 'href'), url) || url;
    const ld = productLd(doc, canonicalUrl) || {};
    const offers = offersOf(ld.offers);
    const offerPrices = offers.map((offer) => money(offer.price ?? offer.lowPrice ?? offer.highPrice)).filter((value) => value !== null);
    const domPrice = money(text(doc, ['.single-product [itemprop="price"]', '.summary .price', '.product-price'])
      || attr(doc, ['meta[property="product:price:amount"]'], 'content'));
    const price = offerPrices.length ? Math.min(...offerPrices) : domPrice;
    const path = new URL(canonicalUrl).pathname.split('/').filter(Boolean);
    const stock = text(doc, ['.stock', '.availability', '[itemprop="availability"]']);
    const crumbs = [...doc.querySelectorAll('.breadcrumb a,.breadcrumbs a,nav[aria-label*="breadcrumb" i] a')]
      .map((node) => clean(node.textContent))
      .filter((item) => item && !/trang chủ|home/i.test(item));
    const name = clean(ld.name) || text(doc, ['h1.product_title', 'h1.product-title', '[itemprop="name"]', '.single-product h1']);
    const sku = clean(ld.sku ?? ld.mpn) || text(doc, ['.sku', '[itemprop="sku"]']);
    const sourceKey = path.at(-1) || path.at(-2) || '';
    const models = modelCandidates(name, sku, sourceKey);
    const description = descriptionAudit(doc, ld.description);
    const attributes = attributeOptions(doc);
    const rawVariants = rawWooVariants(doc, canonicalUrl);
    const partitioned = partitionRawVariants(rawVariants);
    const controls = pageControlRows(attributes, price);
    const descriptionRows = descriptionSizeCupRows(description.rawText, price);

    let variantSource = null;
    let sourceRows = [];
    if (partitioned.orderable.length) {
      variantSource = 'woo-variation';
      sourceRows = partitioned.orderable;
    } else if (controls.length) {
      variantSource = 'page-control';
      sourceRows = controls;
    } else if (descriptionRows.rows.length) {
      variantSource = 'description-explicit-list';
      sourceRows = descriptionRows.rows;
    }

    const grouped = groupOrderableVariants(sourceRows, price);
    const rawVariationColors = rawVariants.flatMap((row) => parseVariationOptions(row.rawOptions).colors);
    const colors = uniq([...attributes.colors, ...rawVariationColors]);
    const availableSizes = uniq([
      ...attributes.sizes.map((value) => splitCombinedSizeCup(value).size),
      ...grouped.variants.map((variant) => variant.size),
    ]);
    const availableCups = uniq([
      ...attributes.cups.map(normalizeCup),
      ...grouped.variants.map((variant) => variant.cup),
    ]);

    const blockers = [];
    const reviewFlags = [];
    if (!grouped.variants.length) blockers.push('no-size-cup-variants');
    if (!rawVariants.length && attributes.sizes.length > 0 && attributes.cups.length > 0 && !descriptionRows.rows.length) blockers.push('unverified-size-cup-combinations');
    if (partitioned.unmapped.length || grouped.unmappedRows.length) blockers.push('unmapped-source-variation-options');
    if (grouped.variants.some((variant) => !variant.priceConsistent)) blockers.push('conflicting-prices-for-size-cup');
    if (grouped.variants.some((variant) => !variant.price)) blockers.push('missing-variant-price');
    if (variantSource === 'description-explicit-list') reviewFlags.push('variants-derived-from-description');
    if (partitioned.ignoredColorOnly.length) reviewFlags.push('color-only-source-variations-ignored-for-ordering');
    if (description.priceCandidates.length && price != null && !description.priceCandidates.includes(price)) reviewFlags.push('description-price-conflicts-current-price');

    return {
      sourceUrl: canonicalUrl,
      sourceKey,
      name,
      sku,
      modelCandidates: models,
      brand: clean(typeof ld.brand === 'string' ? ld.brand : ld.brand?.name),
      category: crumbs.at(-1) || '',
      breadcrumbs: crumbs,
      description: description.rawText,
      featureCandidates: description.featureCandidates,
      descriptionPriceCandidates: description.priceCandidates,
      price,
      compareAtPrice: offerPrices.length > 1 ? Math.max(...offerPrices) : null,
      currency: clean(offers[0]?.priceCurrency) || 'VND',
      inStock: !/outofstock|hết hàng|out of stock/i.test(`${offers[0]?.availability || ''} ${stock}`),
      images: productImages(doc, ld, canonicalUrl, models),
      colors,
      colorSource: colors.length ? 'page-attributes-and-variation-aggregate' : null,
      availableSizes,
      availableCups,
      orderableDimensions: availableCups.length ? ['size', 'cup'] : ['size'],
      variantSource,
      variantEvidenceSegments: descriptionRows.evidenceSegments,
      variants: grouped.variants,
      ignoredColorOnlySourceVariations: partitioned.ignoredColorOnly,
      unmappedSourceVariations: [...partitioned.unmapped, ...grouped.unmappedRows],
      otherAttributes: attributes.other,
      blockers: uniq(blockers),
      reviewFlags: uniq(reviewFlags),
      scrapedAt: new Date().toISOString(),
    };
  }

  function links(doc, base, selectors) {
    return uniq([...doc.querySelectorAll(selectors)].map((node) => sameOriginUrl(node.getAttribute('href'), base)));
  }

  function productLinks(doc, base) {
    const selectors = 'a.woocommerce-LoopProduct-link[href],a.woocommerce-loop-product__link[href],.wc-block-grid__product-link[href],.products .product a[href],[itemtype*="schema.org/Product"] a[href],.product-item a[href],.product-card a[href],.card-product a[href],a[href*="/san-pham/"],a[href*="/product/"],a[href*="/products/"]';
    return links(doc, base, selectors).filter((url) => {
      if (!url) return false;
      const parsed = new URL(url);
      if (parsed.pathname === '/' && !parsed.search) return false;
      return !/\/product-category\//i.test(parsed.pathname);
    });
  }

  function listingLinks(doc, base) {
    const selectors = '.pagination a[href],.woocommerce-pagination a[href],a.next[href],.product-categories a[href],.category-menu a[href],a[href*="/product-category/"],a[href*="/danh-muc-san-pham/"],a[href*="/collections/"],a[href*="/shop/"]';
    return links(doc, base, selectors).filter((url) => {
      const value = new URL(url);
      return cfg.listingHints.some((hint) => value.pathname.toLowerCase().includes(hint)) || /[?&](page|paged|product-page)=\d+/i.test(value.search);
    });
  }

  async function fetchDoc(url) {
    const response = await fetch(url, { credentials: 'include', headers: { Accept: 'text/html,application/xhtml+xml' } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return new DOMParser().parseFromString(await response.text(), 'text/html');
  }

  async function scrapeProduct(url, providedDoc) {
    if (productSeen.has(url) || products.length >= cfg.maxProducts) return;
    productSeen.add(url);
    try {
      const doc = providedDoc || await fetchDoc(url);
      if (!isProductPage(doc, url)) return;
      const product = extractProduct(doc, url);
      if (!product.name || !product.sourceKey) throw new Error('Missing product name or canonical source key');
      products.push(product);
      console.log(`[TT] ${products.length}: ${product.name}`, product);
    } catch (error) {
      errors.push({ stage: 'product', url, message: String(error?.message || error) });
      console.warn('[TT] Product failed', url, error);
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
      const doc = current.doc || await fetchDoc(current.url);
      console.log(`[TT] Visit ${listingSeen.size}: ${current.url}`);
      if (isProductPage(doc, current.url)) {
        await scrapeProduct(current.url, doc);
      } else {
        for (const url of productLinks(doc, current.url)) await scrapeProduct(url);
        for (const url of listingLinks(doc, current.url)) {
          if (!listingSeen.has(url)) queue.push({ url, depth: current.depth + 1, doc: null });
        }
      }
    } catch (error) {
      errors.push({ stage: 'listing', url: current.url, message: String(error?.message || error) });
      console.warn('[TT] Listing failed', current.url, error);
    }
    await sleep(cfg.delayMs);
  }

  const sortedProducts = products.sort((a, b) => a.name.localeCompare(b.name, 'vi'));
  const payload = {
    schemaVersion: 3,
    source: location.origin,
    generatedAt: new Date().toISOString(),
    businessRules: {
      colorsAreProductLevelDisplayData: true,
      colorsDoNotParticipateInOrderVariantIdentity: true,
      orderVariantIdentity: 'product + size + cup',
      descriptionsRequireConciseFeatureReviewBeforeImport: true,
      noCartesianSizeCupInference: true,
      currentPageOrPriceListWinsOverDescriptionPrice: true,
    },
    summary: {
      productCount: sortedProducts.length,
      listingPagesVisited: listingSeen.size,
      productsWithColors: sortedProducts.filter((product) => product.colors.length > 0).length,
      productsWithVariants: sortedProducts.filter((product) => product.variants.length > 0).length,
      productsWithDescriptionVariants: sortedProducts.filter((product) => product.variantSource === 'description-explicit-list').length,
      productsWithFeatureCandidates: sortedProducts.filter((product) => product.featureCandidates.length > 0).length,
      productsWithBlockers: sortedProducts.filter((product) => product.blockers.length > 0).length,
      productsWithReviewFlags: sortedProducts.filter((product) => product.reviewFlags.length > 0).length,
      errorCount: errors.length,
    },
    errors,
    products: sortedProducts,
  };

  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
  const downloadUrl = URL.createObjectURL(blob);
  const anchor = Object.assign(document.createElement('a'), { href: downloadUrl, download: `tuan-thuy-product-audit-${new Date().toISOString().slice(0, 10)}.json` });
  document.body.appendChild(anchor); anchor.click(); anchor.remove(); URL.revokeObjectURL(downloadUrl);
  window.__TT_CATALOG_SCRAPER_RESULT__ = payload;
  window.__TT_SCRAPER_RUNNING__ = false;
  console.log('[TT] Finished', payload);
})().catch((error) => {
  window.__TT_SCRAPER_RUNNING__ = false;
  console.error('[TT] Fatal', error);
});
