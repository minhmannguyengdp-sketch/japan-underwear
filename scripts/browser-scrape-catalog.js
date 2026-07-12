/* Tuấn Thủy catalog audit — paste into DevTools Console on tuanthuy.com.vn */
(async () => {
  'use strict';

  if (window.__TT_SCRAPER_RUNNING__) return console.warn('TT scraper is already running.');
  window.__TT_SCRAPER_RUNNING__ = true;

  const cfg = {
    startUrl: `${location.origin}/`,
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
  const BOILERPLATE = /(đổi trả|giao hàng|thanh toán|hotline|liên hệ|bảo quản|hướng dẫn giặt|chính sách|cam kết|copyright)/i;

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
      return /^https?:$/.test(url.protocol) ? url.href : null;
    } catch { return null; }
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

  function productLd(doc) {
    return ldObjects(doc).find((item) => isType(item, 'Product')) || null;
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
    const raw = clean(value).toUpperCase().replace(/^SIZE\s*/i, '');
    return raw || null;
  }

  function splitCombinedSizeCup(value) {
    const raw = clean(value).toUpperCase().replace(/\s+/g, '');
    const match = raw.match(/^(\d{2,3}|[SMLX]{1,4}|\d?XL|2X|3X|4X)[-\/]?([A-H])$/i);
    if (!match) return { size: normalizeSize(value), cup: null };
    return { size: normalizeSize(match[1]), cup: normalizeCup(match[2]) };
  }

  function rawWooVariants(doc) {
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
            image: assetUrl(row.image?.full_src ?? row.image?.src),
          });
        }
      } catch (error) {
        errors.push({ stage: 'variation-json', url: location.href, message: String(error?.message || error) });
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

  function fallbackSizeCupRows(doc, basePrice) {
    const attributes = attributeOptions(doc);
    const rows = [];
    const sizes = attributes.sizes.length ? attributes.sizes : [null];
    const cups = attributes.cups.length ? attributes.cups : [null];
    for (const sizeValue of sizes) {
      const combined = sizeValue ? splitCombinedSizeCup(sizeValue) : { size: null, cup: null };
      for (const cupValue of cups) {
        const size = combined.size;
        const cup = normalizeCup(cupValue) || combined.cup;
        if (!size && !cup) continue;
        rows.push({
          externalId: '', sku: '', rawOptions: {}, size, cup,
          colors: [], price: basePrice, compareAtPrice: null, inStock: true, image: null,
          evidence: 'page-controls-cartesian-fallback',
        });
      }
    }
    return rows;
  }

  function groupOrderableVariants(rawRows, basePrice) {
    const groups = new Map();
    const unmappedRows = [];
    for (const row of rawRows) {
      const parsed = row.size !== undefined
        ? { size: row.size, cup: row.cup, colors: row.colors || [], other: {} }
        : parseVariationOptions(row.rawOptions);
      if (!parsed.size && !parsed.cup) {
        unmappedRows.push(row);
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
        rawRows: [],
      };
      current.sourceVariantIds.push(row.externalId);
      current.sourceSkus.push(row.sku);
      current.sourceColors.push(...parsed.colors);
      if (row.price != null) current.priceCandidates.push(row.price);
      else if (basePrice != null) current.priceCandidates.push(basePrice);
      if (row.compareAtPrice != null) current.compareAtPriceCandidates.push(row.compareAtPrice);
      current.inStockStates.push(Boolean(row.inStock));
      current.rawRows.push({ externalId: row.externalId, sku: row.sku, rawOptions: row.rawOptions || {}, price: row.price, inStock: row.inStock });
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

    return { variants, unmappedRows };
  }

  function descriptionAudit(doc, ldDescription) {
    const root = doc.querySelector('#tab-description, .woocommerce-Tabs-panel--description, .woocommerce-product-details__short-description, .product-description, [itemprop="description"]');
    const rawText = clean(ldDescription) || clean(root?.textContent);
    const nodes = root ? [...root.querySelectorAll('li, p, h2, h3, h4')] : [];
    const featureCandidates = uniq(nodes
      .map((node) => clean(node.textContent))
      .filter((value) => value.length >= 12 && value.length <= 240 && !BOILERPLATE.test(value)))
      .slice(0, 16);
    return { rawText, featureCandidates };
  }

  function modelCandidates(...values) {
    const found = [];
    for (const value of values) {
      for (const match of clean(value).matchAll(/(?:AL|QL|QG|QI)?['’\s-]*([5789]\d{3})(?:-([A-Z0-9]+))?/gi)) {
        found.push(match[1]);
      }
    }
    return uniq(found);
  }

  function isProductPage(doc) {
    return Boolean(productLd(doc)
      || doc.querySelector('body.single-product, form.cart, [itemtype*="schema.org/Product"]')
      || attr(doc, ['meta[property="og:type"]'], 'content').toLowerCase() === 'product');
  }

  function extractProduct(doc, url) {
    const ld = productLd(doc) || {};
    const offers = offersOf(ld.offers);
    const offerPrices = offers.map((offer) => money(offer.price ?? offer.lowPrice ?? offer.highPrice)).filter((value) => value !== null);
    const domPrice = money(text(doc, ['[itemprop="price"]', '.summary .price', '.product-price', '.price'])
      || attr(doc, ['meta[property="product:price:amount"]'], 'content'));
    const price = offerPrices.length ? Math.min(...offerPrices) : domPrice;
    const path = new URL(url).pathname.split('/').filter(Boolean);
    const stock = text(doc, ['.stock', '.availability', '[itemprop="availability"]']);
    const ldImages = (Array.isArray(ld.image) ? ld.image : [ld.image]).map((item) => assetUrl(typeof item === 'string' ? item : item?.url));
    const domImages = [attr(doc, ['meta[property="og:image"]'], 'content'), ...[...doc.querySelectorAll('.woocommerce-product-gallery img, .product-gallery img, main img')].slice(0, 20).map((img) => img.currentSrc || img.src || img.dataset.src)].map((item) => assetUrl(item, url));
    const crumbs = [...doc.querySelectorAll('.breadcrumb a,.breadcrumbs a,nav[aria-label*="breadcrumb" i] a')].map((node) => clean(node.textContent)).filter((item) => item && !/trang chủ|home/i.test(item));
    const name = clean(ld.name) || text(doc, ['h1.product_title', 'h1.product-title', '[itemprop="name"]', 'main h1', 'h1']) || attr(doc, ['meta[property="og:title"]'], 'content');
    const sku = clean(ld.sku ?? ld.mpn) || text(doc, ['.sku', '[itemprop="sku"]']);
    const sourceKey = path.at(-1) || path.at(-2) || '';
    const attributes = attributeOptions(doc);
    const rawVariants = rawWooVariants(doc);
    const sourceRows = rawVariants.length ? rawVariants : fallbackSizeCupRows(doc, price);
    const grouped = groupOrderableVariants(sourceRows, price);
    const variationColors = rawVariants.flatMap((row) => parseVariationOptions(row.rawOptions).colors);
    const description = descriptionAudit(doc, ld.description);
    const colors = uniq([...attributes.colors, ...variationColors]);
    const blockers = [];
    if (!grouped.variants.length) blockers.push('no-size-cup-variants');
    if (grouped.unmappedRows.length) blockers.push('unmapped-source-variation-options');
    if (grouped.variants.some((variant) => !variant.priceConsistent)) blockers.push('conflicting-prices-for-size-cup');
    if (grouped.variants.some((variant) => !variant.price)) blockers.push('missing-variant-price');

    return {
      sourceUrl: url,
      sourceKey,
      name,
      sku,
      modelCandidates: modelCandidates(name, sku, sourceKey),
      brand: clean(typeof ld.brand === 'string' ? ld.brand : ld.brand?.name),
      category: crumbs.at(-1) || '',
      breadcrumbs: crumbs,
      description: description.rawText,
      featureCandidates: description.featureCandidates,
      price,
      compareAtPrice: offerPrices.length > 1 ? Math.max(...offerPrices) : null,
      currency: clean(offers[0]?.priceCurrency) || 'VND',
      inStock: !/outofstock|hết hàng|out of stock/i.test(`${offers[0]?.availability || ''} ${stock}`),
      images: uniq([...ldImages, ...domImages]),
      colors,
      colorSource: colors.length ? 'page-attributes-and-variation-aggregate' : null,
      orderableDimensions: ['size', 'cup'],
      variants: grouped.variants,
      unmappedSourceVariations: grouped.unmappedRows,
      otherAttributes: attributes.other,
      blockers: uniq(blockers),
      scrapedAt: new Date().toISOString(),
    };
  }

  function links(doc, base, selectors) {
    return uniq([...doc.querySelectorAll(selectors)].map((node) => sameOriginUrl(node.getAttribute('href'), base)));
  }

  function productLinks(doc, base) {
    const selectors = 'a.woocommerce-LoopProduct-link[href],a.woocommerce-loop-product__link[href],.products .product a[href],[itemtype*="schema.org/Product"] a[href],.product-item a[href],.product-card a[href],.card-product a[href],a[href*="/san-pham/"],a[href*="/product/"],a[href*="/products/"]';
    return links(doc, base, selectors).filter((url) => url && !/\/product-category\//i.test(url));
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
      if (!isProductPage(doc)) return;
      const product = extractProduct(doc, url);
      if (!product.name) throw new Error('Missing product name');
      products.push(product);
      console.log(`[TT] ${products.length}: ${product.name}`, product);
    } catch (error) {
      errors.push({ stage: 'product', url, message: String(error?.message || error) });
      console.warn('[TT] Product failed', url, error);
    }
    await sleep(cfg.delayMs);
  }

  const queue = [{ url: cfg.startUrl, depth: 0, doc: document }];
  while (queue.length && listingSeen.size < cfg.maxListingPages) {
    const current = queue.shift();
    if (listingSeen.has(current.url) || current.depth > cfg.maxDepth) continue;
    listingSeen.add(current.url);
    try {
      const doc = current.doc || await fetchDoc(current.url);
      console.log(`[TT] Listing ${listingSeen.size}: ${current.url}`);
      if (isProductPage(doc)) await scrapeProduct(current.url, doc);
      else {
        for (const url of productLinks(doc, current.url)) await scrapeProduct(url);
        for (const url of listingLinks(doc, current.url)) if (!listingSeen.has(url)) queue.push({ url, depth: current.depth + 1 });
      }
    } catch (error) {
      errors.push({ stage: 'listing', url: current.url, message: String(error?.message || error) });
      console.warn('[TT] Listing failed', current.url, error);
    }
    await sleep(cfg.delayMs);
  }

  const sortedProducts = products.sort((a, b) => a.name.localeCompare(b.name, 'vi'));
  const payload = {
    schemaVersion: 2,
    source: location.origin,
    generatedAt: new Date().toISOString(),
    businessRules: {
      colorsAreProductLevelDisplayData: true,
      colorsDoNotParticipateInOrderVariantIdentity: true,
      orderVariantIdentity: 'product + size + cup',
      descriptionsRequireConciseFeatureReviewBeforeImport: true,
    },
    summary: {
      productCount: sortedProducts.length,
      listingPagesVisited: listingSeen.size,
      productsWithColors: sortedProducts.filter((product) => product.colors.length > 0).length,
      productsWithVariants: sortedProducts.filter((product) => product.variants.length > 0).length,
      productsWithFeatureCandidates: sortedProducts.filter((product) => product.featureCandidates.length > 0).length,
      productsWithBlockers: sortedProducts.filter((product) => product.blockers.length > 0).length,
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
