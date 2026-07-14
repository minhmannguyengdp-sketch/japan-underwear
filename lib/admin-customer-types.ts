export type AdminCustomerStatus = "active" | "blocked";
export type AdminCustomerRole = "customer" | "sales" | "admin";
export type AdminCustomerOrderStatus =
  | "submitted"
  | "confirmed"
  | "processing"
  | "completed"
  | "cancelled";

export type AdminCustomerSummary = {
  userId: string;
  email: string | null;
  name: string | null;
  status: AdminCustomerStatus;
  roles: AdminCustomerRole[];
  storeName: string | null;
  contactName: string | null;
  phone: string | null;
  deliveryAddress: string | null;
  profileCompleted: boolean;
  sessionCount: number;
  orderCount: number;
  lifetimeValue: number;
  lastOrderAt: string | null;
  lastLoginAt: string | null;
  createdAt: string;
};

export type AdminCustomerOrderSummary = {
  orderCode: string;
  status: AdminCustomerOrderStatus;
  subtotal: number;
  currency: string;
  itemQuantity: number;
  createdAt: string;
};

export type AdminCustomerAuditEvent = {
  id: string;
  actor: string;
  action: string;
  details: Record<string, unknown>;
  createdAt: string;
};

export type AdminCustomerDetail = AdminCustomerSummary & {
  orders: AdminCustomerOrderSummary[];
  auditEvents: AdminCustomerAuditEvent[];
};

export type AdminCustomerStatusChange = {
  userId: string;
  previousStatus: AdminCustomerStatus;
  currentStatus: AdminCustomerStatus;
  changed: boolean;
  revokedSessions: number;
};