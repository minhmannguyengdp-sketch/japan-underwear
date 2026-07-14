export type CustomerOrderStatus = "submitted" | "confirmed" | "cancelled";

export type CustomerOrderSummary = {
  orderCode: string;
  status: CustomerOrderStatus;
  customerName: string;
  customerPhone: string;
  deliveryAddress: string | null;
  subtotal: number;
  currency: string;
  itemQuantity: number;
  createdAt: string;
  updatedAt: string;
};

export type CustomerOrderItem = {
  id: string;
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

export type CustomerOrderStatusEvent = {
  id: string;
  fromStatus: CustomerOrderStatus | null;
  toStatus: CustomerOrderStatus;
  reason: string | null;
  createdAt: string;
};

export type CustomerOrderLocation = {
  latitude: number;
  longitude: number;
  accuracyMeters: number;
  collectedAt: string;
  source: "browser_geolocation";
};

export type CustomerOrderDetail = CustomerOrderSummary & {
  note: string | null;
  location: CustomerOrderLocation | null;
  items: CustomerOrderItem[];
  history: CustomerOrderStatusEvent[];
};
