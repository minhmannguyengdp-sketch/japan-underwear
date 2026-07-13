export type StaffOrderStatus = "submitted" | "confirmed" | "cancelled";
export type StaffOrderFilter = StaffOrderStatus | "all";

export type StaffOrderSummary = {
  id: string;
  orderCode: string;
  status: StaffOrderStatus;
  customerName: string;
  customerPhone: string;
  deliveryAddress: string | null;
  subtotal: number;
  currency: string;
  itemQuantity: number;
  createdAt: string;
  updatedAt: string;
};

export type StaffOrderItem = {
  id: string;
  productVariantId: string;
  colorId: string;
  productCode: string;
  productName: string;
  colorCode: string;
  colorName: string;
  sizeCode: string;
  cupCode: string | null;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
};

export type StaffOrderStatusEvent = {
  id: string;
  fromStatus: StaffOrderStatus | null;
  toStatus: StaffOrderStatus;
  actorSource: string;
  actorLabel: string;
  reason: string | null;
  idempotencyKey: string | null;
  createdAt: string;
};

export type StaffOrderLocation = {
  latitude: number;
  longitude: number;
  accuracyMeters: number;
  collectedAt: string;
  source: "browser_geolocation";
};

export type StaffOrderDetail = StaffOrderSummary & {
  note: string | null;
  location: StaffOrderLocation | null;
  items: StaffOrderItem[];
  history: StaffOrderStatusEvent[];
};

export type StaffOrderTransition = {
  orderId: string;
  orderCode: string;
  previousStatus: StaffOrderStatus;
  currentStatus: StaffOrderStatus;
  changed: boolean;
  idempotent: boolean;
  eventId: string | null;
  changedAt: string | null;
};
