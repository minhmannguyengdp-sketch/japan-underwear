export type CatalogAdminStatusFilter = "all" | "active" | "inactive";
export type CatalogAdminEntityType = "product" | "color" | "variant";

export type ManagedCatalogColor = {
  id: string;
  code: string;
  name: string;
  swatch: string | null;
  sortOrder: number;
  isActive: boolean;
  rowVersion: number;
  updatedAt: string;
};

export type ManagedCatalogVariant = {
  id: string;
  sizeCode: string;
  cupCode: string | null;
  label: string;
  sku: string | null;
  priceOverride: number | null;
  effectivePrice: number;
  isActive: boolean;
  rowVersion: number;
  updatedAt: string;
};

export type ManagedCatalogProduct = {
  id: string;
  modelCode: string;
  name: string;
  shortDescription: string | null;
  brandName: string;
  brandSlug: string;
  categoryName: string;
  categorySlug: string;
  basePrice: number;
  currency: string;
  isActive: boolean;
  rowVersion: number;
  updatedAt: string;
  colors: ManagedCatalogColor[];
  variants: ManagedCatalogVariant[];
};

export type CatalogChangeAuditEvent = {
  id: string;
  actorUserId: string | null;
  actorLabel: string;
  requestId: string | null;
  entityType: CatalogAdminEntityType;
  entityId: string;
  productId: string;
  action: "updated";
  beforeSnapshot: Record<string, unknown>;
  afterSnapshot: Record<string, unknown>;
  createdAt: string;
};

export type ManagedCatalogData = {
  products: ManagedCatalogProduct[];
  auditEvents: CatalogChangeAuditEvent[];
};

export type CatalogAdminActor = {
  userId: string;
  label: string;
  requestId: string;
};

export type UpdateManagedProductInput = {
  expectedVersion: number;
  name?: string;
  shortDescription?: string | null;
  basePrice?: number;
  isActive?: boolean;
};

export type UpdateManagedColorInput = {
  expectedVersion: number;
  name?: string;
  swatch?: string | null;
  sortOrder?: number;
  isActive?: boolean;
};

export type UpdateManagedVariantInput = {
  expectedVersion: number;
  sku?: string | null;
  priceOverride?: number | null;
  isActive?: boolean;
};
