import { config as loadEnv } from "dotenv";
import { promises as fs } from "node:fs";
import path from "node:path";

loadEnv({ path: path.resolve(process.cwd(), ".env.local") });
loadEnv({ path: path.resolve(process.cwd(), ".env") });

const IMAGE_EXTENSIONS = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".avif",
]);

const RESERVED_NUMBER_TOKENS = new Set(["1080", "1200", "1600", "1920"]);
const ttRoot = path.resolve(
  process.env.LOCAL_TT_ROOT ?? path.join(process.cwd(), ".."),
);

const sourceDefinitions = [
  {
    name: "winking",
    brandHint: "winking",
    categoryHint: null,
    root: path.resolve(
      process.env.LOCAL_WINKING_IMAGES ?? path.join(ttRoot, "WK_1600"),
    ),
  },
  {
    name: "pensee",
    brandHint: "pensee",
    categoryHint: null,
    root: path.resolve(
      process.env.LOCAL_PENSEE_IMAGES ?? path.join(ttRoot, "pensee_1600"),
    ),
  },
  {
    name: "quan-lot",
    brandHint: null,
    categoryHint: "quan-lot",
    root: path.resolve(
      process.env.LOCAL_QL_IMAGES ?? path.join(ttRoot, "QL"),
    ),
  },
];

const priceFile = path.resolve(
  process.env.LOCAL_PRICE_FILE ??
    path.join(ttRoot, "Bang_bao_gia_Winking_Pensee.xlsx"),
);

const outputFile = path.resolve(
  process.env.LOCAL_CATALOG_MANIFEST ??
    path.join(process.cwd(), "data", "local", "catalog-manifest.json"),
);

function normalizePath(filePath) {
  return filePath.split(path.sep).join("/");
}

function inferModelCode(relativePath) {
  const segments = relativePath.split(/[\\/]/).filter(Boolean);

  for (const segment of segments) {
    const matches = segment.matchAll(/(?:^|\D)(\d{4})(?=\D|$)/g);

    for (const match of matches) {
      const candidate = match[1];
      if (!RESERVED_NUMBER_TOKENS.has(candidate)) return candidate;
    }
  }

  return null;
}

function inferBrand(relativePath, brandHint) {
  if (brandHint) return brandHint;

  const normalized = relativePath
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

  if (/(^|[^a-z])(pensee|pensees|penseé|ps)([^a-z]|$)/i.test(normalized)) {
    return "pensee";
  }

  if (/(^|[^a-z])(winking|wk)([^a-z]|$)/i.test(normalized)) {
    return "winking";
  }

  return "unclassified";
}

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function walkImages(root) {
  const files = [];

  async function visit(directory) {
    const entries = await fs.readdir(directory, { withFileTypes: true });

    for (const entry of entries) {
      const absolutePath = path.join(directory, entry.name);

      if (entry.isDirectory()) {
        await visit(absolutePath);
        continue;
      }

      if (!entry.isFile()) continue;

      const extension = path.extname(entry.name).toLowerCase();
      if (!IMAGE_EXTENSIONS.has(extension)) continue;

      const stat = await fs.stat(absolutePath);
      files.push({
        absolutePath,
        relativePath: path.relative(root, absolutePath),
        fileName: entry.name,
        extension,
        sizeBytes: stat.size,
        modifiedAt: stat.mtime.toISOString(),
      });
    }
  }

  await visit(root);
  return files;
}

const sourceReports = [];
const productGroups = new Map();
const unmatchedFiles = [];

for (const source of sourceDefinitions) {
  if (!(await pathExists(source.root))) {
    sourceReports.push({
      name: source.name,
      root: source.root,
      exists: false,
      imageCount: 0,
    });
    continue;
  }

  const files = await walkImages(source.root);
  sourceReports.push({
    name: source.name,
    root: source.root,
    exists: true,
    imageCount: files.length,
  });

  for (const file of files) {
    const modelCode = inferModelCode(file.relativePath);
    const brand = inferBrand(file.relativePath, source.brandHint);
    const image = {
      source: source.name,
      relativeToSource: normalizePath(file.relativePath),
      relativeToTtRoot: normalizePath(path.relative(ttRoot, file.absolutePath)),
      fileName: file.fileName,
      extension: file.extension,
      sizeBytes: file.sizeBytes,
      modifiedAt: file.modifiedAt,
    };

    if (!modelCode) {
      unmatchedFiles.push({
        ...image,
        reason: "Không tìm thấy mã model 4 chữ số trong tên thư mục hoặc tên file.",
      });
      continue;
    }

    const groupKey = `${brand}:${modelCode}`;
    const current = productGroups.get(groupKey) ?? {
      brand,
      modelCode,
      categoryHint: source.categoryHint,
      sources: new Set(),
      images: [],
    };

    current.sources.add(source.name);
    current.categoryHint ??= source.categoryHint;
    current.images.push(image);
    productGroups.set(groupKey, current);
  }
}

const products = [...productGroups.values()]
  .map((product) => ({
    ...product,
    sources: [...product.sources].sort(),
    images: product.images.sort((left, right) =>
      left.relativeToTtRoot.localeCompare(right.relativeToTtRoot, "vi"),
    ),
  }))
  .sort((left, right) => {
    const brandCompare = left.brand.localeCompare(right.brand, "vi");
    if (brandCompare !== 0) return brandCompare;
    return left.modelCode.localeCompare(right.modelCode, "vi");
  });

const manifest = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  ttRoot,
  outputFile,
  priceFile: {
    path: priceFile,
    exists: await pathExists(priceFile),
  },
  summary: {
    sourceCount: sourceReports.length,
    availableSourceCount: sourceReports.filter((source) => source.exists).length,
    productGroupCount: products.length,
    matchedImageCount: products.reduce(
      (sum, product) => sum + product.images.length,
      0,
    ),
    unmatchedImageCount: unmatchedFiles.length,
  },
  sources: sourceReports,
  products,
  unmatchedFiles: unmatchedFiles.sort((left, right) =>
    left.relativeToTtRoot.localeCompare(right.relativeToTtRoot, "vi"),
  ),
};

await fs.mkdir(path.dirname(outputFile), { recursive: true });
await fs.writeFile(outputFile, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

console.log(`Đã tạo manifest: ${outputFile}`);
console.log(
  `Model: ${manifest.summary.productGroupCount} | ` +
    `Ảnh khớp: ${manifest.summary.matchedImageCount} | ` +
    `Ảnh chưa khớp: ${manifest.summary.unmatchedImageCount}`,
);

for (const source of sourceReports.filter((item) => !item.exists)) {
  console.warn(`Không tìm thấy thư mục nguồn: ${source.root}`);
}

if (!manifest.priceFile.exists) {
  console.warn(`Không tìm thấy file bảng giá: ${priceFile}`);
}
