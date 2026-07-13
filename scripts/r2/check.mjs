import {
  DeleteObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { loadR2Config } from "./config.mjs";

const { bucket, endpoint, jurisdiction, client } = loadR2Config();
const key = `_health/${Date.now()}-${Math.random().toString(36).slice(2)}.txt`;

try {
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: "japan-underwear-r2-check\n",
      ContentType: "text/plain; charset=utf-8",
      CacheControl: "no-store",
      Metadata: {
        purpose: "credential-check",
      },
    }),
  );

  await client.send(
    new HeadObjectCommand({
      Bucket: bucket,
      Key: key,
    }),
  );

  await client.send(
    new DeleteObjectCommand({
      Bucket: bucket,
      Key: key,
    }),
  );

  console.log("R2 OK: ghi, đọc metadata và xóa object kiểm tra thành công.");
  console.log(`Bucket: ${bucket}`);
  console.log(`Endpoint: ${endpoint}`);
  console.log(`Jurisdiction: ${jurisdiction}`);
} catch (error) {
  try {
    await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
  } catch {}

  const name = error && typeof error === "object" && "name" in error ? error.name : "Error";
  const message = error instanceof Error ? error.message : String(error);
  const status =
    error && typeof error === "object" && "$metadata" in error
      ? error.$metadata?.httpStatusCode
      : undefined;

  console.error("R2 check thất bại.");
  console.error(`Type: ${name}`);
  if (status) console.error(`HTTP: ${status}`);
  console.error(`Bucket: ${bucket}`);
  console.error(`Endpoint: ${endpoint}`);
  console.error(message);

  if (name === "SignatureDoesNotMatch" || /signature/i.test(message)) {
    console.error("\nKiểm tra theo thứ tự:");
    console.error("1. Chạy npm run r2:diagnose.");
    console.error(
      "2. R2_ACCESS_KEY_ID và R2_SECRET_ACCESS_KEY phải là cặp S3 credentials tạo cùng một lần trong R2 API Tokens, không phải Global API Key hay chuỗi API token thông thường.",
    );
    console.error(
      "3. Nếu bucket thuộc EU/FedRAMP, đặt R2_JURISDICTION=eu hoặc fedramp.",
    );
    console.error(
      "4. Nếu secret có dấu #, đặt toàn bộ giá trị trong dấu nháy kép ở .env.local.",
    );
    console.error("5. Nếu không còn Secret Access Key gốc, revoke token và tạo cặp mới.");
  }

  process.exitCode = 1;
} finally {
  client.destroy();
}
