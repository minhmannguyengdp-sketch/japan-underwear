import { getPool } from "@/db/client";

export type CustomerProfile = {
  userId: string;
  storeName: string;
  contactName: string;
  phone: string;
  deliveryAddress: string;
  createdAt: string;
  updatedAt: string;
};

export type CustomerProfileInput = {
  storeName: string;
  contactName: string;
  phone: string;
  deliveryAddress: string;
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

function mapProfile(row: Record<string, unknown>): CustomerProfile {
  return {
    userId: String(row.user_id),
    storeName: String(row.store_name),
    contactName: String(row.contact_name),
    phone: String(row.phone),
    deliveryAddress: String(row.delivery_address),
    createdAt: new Date(String(row.created_at)).toISOString(),
    updatedAt: new Date(String(row.updated_at)).toISOString(),
  };
}

export async function getCustomerProfile(userId: string): Promise<CustomerProfile | null> {
  const result = await getPool().query(
    `
      SELECT
        user_id,
        store_name,
        contact_name,
        phone,
        delivery_address,
        created_at,
        updated_at
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
  const result = await getPool().query(
    `
      INSERT INTO japan_underwear.customer_profiles (
        user_id,
        store_name,
        contact_name,
        phone,
        delivery_address
      ) VALUES ($1::uuid, $2, $3, $4, $5)
      ON CONFLICT (user_id)
      DO UPDATE SET
        store_name = EXCLUDED.store_name,
        contact_name = EXCLUDED.contact_name,
        phone = EXCLUDED.phone,
        delivery_address = EXCLUDED.delivery_address,
        updated_at = now()
      RETURNING
        user_id,
        store_name,
        contact_name,
        phone,
        delivery_address,
        created_at,
        updated_at
    `,
    [
      userId,
      input.storeName.trim(),
      input.contactName.trim(),
      input.phone.trim(),
      input.deliveryAddress.trim(),
    ],
  );

  if (result.rowCount !== 1) {
    throw new CustomerProfileError("Không lưu được hồ sơ khách hàng.", 500, "profile_save_failed");
  }

  return mapProfile(result.rows[0]);
}
