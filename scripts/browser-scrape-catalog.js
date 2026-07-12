/* Tuấn Thủy catalog scraper — paste into DevTools Console on tuanthuy.com.vn */
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
  const uniq = (values) => [...new Set(values.filter(Boolean))];

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
    if (typeof value === 'number' && Number.isFinite(value)) return value;
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

  function wooVariants(doc) {
    const form = doc.querySelector('form.variations_form[data-product_variations]');
    if (!form) return [];
    try {
      return JSON.parse(form.getAttribute('data-product_variations') || '[]').map((row) => ({
        externalId: String(row.variation_id || ''),
        sku: clean(row.sku),
        options: Object.fromEntries(Object.entries(row.attributes || {})
          .map(([key, value]) => [clean(key.replace(/^attribute_/, '').replace(/^pa_/, '').replace(/[-_]+/g, ' ')), clean(value)])
          .filter(([key, value]) => key && value)),
        price: money(row.display_price ?? row.price_html),
        compareAtPrice: money(row.display_regular_price),
        inStock: Boolean(row.is_in_stock ?? row.is_purchasable),
        image: assetUrl(row.image?.full_src ?? row.image?.src),
      }));
    } catch { return []; }
  }

  function sizeVariants(doc, basePrice) {
    const rows = [];
    const sizeWords = /(size|kích cỡ|kích thước|cỡ|sz)/i;
    for (const select of doc.querySelectorAll('select')) {
      const label = clean(`${select.name} ${select.id} ${select.getAttribute('aria-label')}`);
      if (!sizeWords.test(label)) continue;
      for (const option of select.options) {
        const value = clean(option.value);
        const name = clean(option.textContent);
        if (!value || option.disabled || /chọn|select|choose/i.test(name)) continue;
        rows.push({ externalId: value, sku: '', options: { size: name }, price: money(option.dataset.price) ?? basePrice, compareAtPrice: null, inStock: true, image: null });
      }
    }
    for (const node of doc.querySelectorAll('[data-variation-id][data-value], [data-variation_id][data-value], .swatch[data-value], .variable-item[data-value]')) {
      const value = clean(node.dataset.value || node.textContent);
      if (!value) continue;
      rows.push({
        externalId: clean(node.dataset.variationId || node.getAttribute('data-variation_id') || value),
        sku: clean(node.dataset.sku), options: { size: value }, price: money(node.dataset.price) ?? basePrice,
        compareAtPrice: money(node.dataset.regularPrice), inStock: !node.matches('.disabled,[disabled],.out-of-stock'), image: assetUrl(node.dataset.image),
      });
    }
    const seen = new Set();
    return rows.filter((row) => { const key = JSON.stringify(row.options); if (seen.has(key)) return false; seen.add(key); return true; });
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
    const variants = wooVariants(doc);
    const path = new URL(url).pathname.split('/').filter(Boolean);
    const stock = text(doc, ['.stock', '.availability', '[itemprop="availability"]']);
    const ldImages = (Array.isArray(ld.image) ? ld.image : [ld.image]).map((item) => assetUrl(typeof item === 'string' ? item : item?.url));
    const domImages = [attr(doc, ['meta[property="og:image"]'], 'content'), ...[...doc.querySelectorAll('.woocommerce-product-gallery img, .product-gallery img, main img')].slice(0, 20).map((img) => img.currentSrc || img.src || img.dataset.src)].map((item) => assetUrl(item, url));
    const crumbs = [...doc.querySelectorAll('.breadcrumb a,.breadcrumbs a,nav[aria-label*="breadcrumb" i] a')].map((node) => clean(node.textContent)).filter((item) => item && !/trang chủ|home/i.test(item));
    const base = {
      sourceUrl: url,
      sourceKey: path.at(-1) || path.at(-2) || '',
      name: clean(ld.name) || text(doc, ['h1.product_title', 'h1.product-title', '[itemprop="name"]', 'main h1', 'h1']) || attr(doc, ['meta[property="og:title"]'], 'content'),
      sku: clean(ld.sku ?? ld.mpn) || text(doc, ['.sku', '[itemprop="sku"]']),
      brand: clean(typeof ld.brand === 'string' ? ld.brand : ld.brand?.name),
      category: crumbs.at(-1) || '',
      description: clean(ld.description) || text(doc, ['#tab-description', '.woocommerce-product-details__short-description', '.product-description', '[itemprop="description"]']),
      price,
      compareAtPrice: offerPrices.length > 1 ? Math.max(...offerPrices) : null,
      currency: clean(offers[0]?.priceCurrency) || 'VND',
      inStock: !/outofstock|hết hàng|out of stock/i.test(`${offers[0]?.availability || ''} ${stock}`),
      images: uniq([...ldImages, ...domImages]),
      variants: variants.length ? variants : sizeVariants(doc, price),
      scrapedAt: new Date().toISOString(),
    };
    base.variants = base.variants.map((variant, index) => ({
      variantKey: variant.sku || `${base.sourceKey}-${clean(variant.options.size || index + 1).toLowerCase().replace(/\s+/g, '-')}`,
      ...variant,
    }));
    return base;
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

  const payload = {
    source: location.origin,
    generatedAt: new Date().toISOString(),
    productCount: products.length,
    listingPagesVisited: listingSeen.size,
    errors,
    products: products.sort((a, b) => a.name.localeCompare(b.name, 'vi')),
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
  const downloadUrl = URL.createObjectURL(blob);
  const anchor = Object.assign(document.createElement('a'), { href: downloadUrl, download: `tuan-thuy-catalog-${new Date().toISOString().slice(0, 10)}.json` });
  document.body.appendChild(anchor); anchor.click(); anchor.remove(); URL.revokeObjectURL(downloadUrl);
  window.__TT_CATALOG_SCRAPER_RESULT__ = payload;
  window.__TT_SCRAPER_RUNNING__ = false;
  console.log('[TT] Finished', payload);
})();
