export type ServerCartItem = {
  id: string;
  productId: string;
  productVariantId: string;
  colorId: string;
  productCode: string;
  productName: string;
  colorCode: string;
  colorLabel: string;
  size: string;
  cup: string | null;
  variantLabel: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  currency: string;
};

export type ServerCart = {
  items: ServerCartItem[];
  quantity: number;
  subtotal: number;
  currency: string;
};

export type AddCartItemInput = {
  productVariantId: string;
  colorId: string;
  quantity: number;
};

export type CheckoutInput = {
  customerName: string;
  customerPhone: string;
  deliveryAddress?: string | null;
  note?: string | null;
};

export type CreatedOrder = {
  id: string;
  orderCode: string;
  status: "submitted";
  subtotal: number;
  currency: string;
  itemCount: number;
  createdAt: string;
};
