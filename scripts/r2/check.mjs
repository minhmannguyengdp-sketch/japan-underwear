import {
  DeleteObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { loadR2Config } from "./config.mjs";

const { bucket, endpoint, client } = loadR2Config();
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
} catch (error) {
  try {
    await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
  } catch {}

  console.error("R2 check thất bại.");
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  client.destroy();
}
