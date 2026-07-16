import { getPool } from "@/db/client";

export type ShopLocation = {
  latitude: number;
  longitude: number;
  accuracyMeters: number;
  collectedAt: string;
  source: "browser_geolocation";
};

export type CustomerProfile = {
  userId: string;
  storeName: string;
  contactName: string;
  phone: string;
  deliveryAddress: string;
  shopLocation: ShopLocation | null;
  createdAt: string;
  updatedAt: string;
};

export type CustomerProfileInput = {
  storeName: string;
  contactName: string;
  phone: string;
  deliveryAddress: string;
  shopLocation?: ShopLocation | null;
};

export class CustomerProfileError extends Error {
  constructor(
    message: string,
    public readonly status = 400,
    public readonly code = "customer_profile_error",
  ) {
    super(message);
    this.name = "CustomerProfileError";
  }
}

function mapShopLocation(row: Record<string, unknown>): ShopLocation | null {
  const values = [
    row.shop_latitude,
    row.shop_longitude,
    row.shop_accuracy_meters,
    row.shop_location_collected_at,
    row.shop_location_source,
  ];
  if (values.every((value) => value === null || value === undefined)) return null;
  if (values.some((value) => value === null || value === undefined)) {
    throw new CustomerProfileError(
      "Vị trí cửa hàng trong hồ sơ chưa đầy đủ.",
      500,
      "invalid_stored_shop_location",
    );
  }

  return {
    latitude: Number(row.shop_latitude),
    longitude: Number(row.shop_longitude),
    accuracyMeters: Number(row.shop_accuracy_meters),
    collectedAt: new Date(String(row.shop_location_collected_at)).toISOString(),
    source: "browser_geolocation",
  };
}

function mapProfile(row: Record<string, unknown>): CustomerProfile {
  return {
    userId: String(row.user_id),
    storeName: String(row.store_name),
    contactName: String(row.contact_name),
    phone: String(row.phone),
    deliveryAddress: String(row.delivery_address),
    shopLocation: mapShopLocation(row),
    createdAt: new Date(String(row.created_at)).toISOString(),
    updatedAt: new Date(String(row.updated_at)).toISOString(),
  };
}

const PROFILE_COLUMNS = `
  user_id,
  store_name,
  contact_name,
  phone,
  delivery_address,
  shop_latitude,
  shop_longitude,
  shop_accuracy_meters,
  shop_location_collected_at,
  shop_location_source,
  created_at,
  updated_at
`;

export async function getCustomerProfile(userId: string): Promise<CustomerProfile | null> {
  const result = await getPool().query(
    `
      SELECT ${PROFILE_COLUMNS}
      FROM japan_underwear.customer_profiles
      WHERE user_id = $1::uuid
      LIMIT 1
    `,
    [userId],
  );

  return result.rowCount === 1 ? mapProfile(result.rows[0]) : null;
}

export async function saveCustomerProfile(
  userId: string,
  input: CustomerProfileInput,
): Promise<CustomerProfile> {
  const location = input.shopLocation ?? null;
  const result = await getPool().query(
    `
      INSERT INTO japan_underwear.customer_profiles (
        user_id,
        store_name,
        contact_name,
        phone,
        delivery_address,
        shop_latitude,
        shop_longitude,
        shop_accuracy_meters,
        shop_location_collected_at,
        shop_location_source
      ) VALUES (
        $1::uuid,
        $2,
        $3,
        $4,
        $5,
        $6,
        $7,
        $8,
        $9::timestamptz,
        $10
      )
      ON CONFLICT (user_id)
      DO UPDATE SET
        store_name = EXCLUDED.store_name,
        contact_name = EXCLUDED.contact_name,
        phone = EXCLUDED.phone,
        delivery_address = EXCLUDED.delivery_address,
        shop_latitude = EXCLUDED.shop_latitude,
        shop_longitude = EXCLUDED.shop_longitude,
        shop_accuracy_meters = EXCLUDED.shop_accuracy_meters,
        shop_location_collected_at = EXCLUDED.shop_location_collected_at,
        shop_location_source = EXCLUDED.shop_location_source,
        updated_at = now()
      RETURNING ${PROFILE_COLUMNS}
    `,
    [
      userId,
      input.storeName.trim(),
      input.contactName.trim(),
      input.phone.trim(),
      input.deliveryAddress.trim(),
      location?.latitude ?? null,
      location?.longitude ?? null,
      location?.accuracyMeters ?? null,
      location?.collectedAt ?? null,
      location?.source ?? null,
    ],
  );

  if (result.rowCount !== 1) {
    throw new CustomerProfileError("Không lưu được hồ sơ khách hàng.", 500, "profile_save_failed");
  }

  return mapProfile(result.rows[0]);
}
