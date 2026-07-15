export type CatalogImage = {
  id: string;
  r2Key: string;
  src: string | null;
  alt: string;
  sortOrder: number;
  isCover: boolean;
};

export type CatalogColor = {
  id: string;
  code: string;
  label: string;
  swatch: string | null;
  sortOrder: number;
  variantIds: string[];
};

export type CatalogVariant = {
  id: string;
  size: string;
  cup: string | null;
  label: string;
  sku: string | null;
  price: number;
};

export type CatalogProduct = {
  id: string;
  brand: string;
  brandSlug: string;
  category: string | null;
  categorySlug: string | null;
  code: string;
  name: string;
  slug: string;
  description: string | null;
  price: number;
  currency: string;
  images: CatalogImage[];
  colors: CatalogColor[];
  variants: CatalogVariant[];
  orderable: boolean;
  orderingBlocker: "missing-color" | "missing-size-cup" | "missing-color-size-link" | null;
};

export type CatalogQuery = {
  q?: string;
  brand?: string;
  category?: string;
  limit?: number;
};
