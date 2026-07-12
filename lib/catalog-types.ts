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
};

export type CatalogVariant = {
  id: string;
  colorId: string;
  size: string;
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
};

export type CatalogQuery = {
  q?: string;
  brand?: string;
  category?: string;
  limit?: number;
};
