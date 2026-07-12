import { config as loadEnv } from "dotenv";
import { promises as fs } from "node:fs";
import path from "node:path";

loadEnv({ path: path.resolve(process.cwd(), ".env.local"), quiet: true });
loadEnv({ path: path.resolve(process.cwd(), ".env"), quiet: true });

const IMAGE_EXTENSIONS = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".avif",
]);

const RESERVED_NUMBER_TOKENS = new Set(["1080", "1200", "1600", "1920"]);
const YEAR_MIN = 1900;
const YEAR_MAX = 2099;

const MODEL_RULES = [
  { prefix: "95", brand: "pensee", category: "ao-nguc" },
  { prefix: "85", brand: "pensee", category: "quan-lot" },
  { prefix: "90", brand: "winking", category: "ao-nguc" },
  { prefix: "80", brand: "winking", category: "quan-lot" },
];

const PRODUCT_PREFIX_RULES = {
  AL: "ao-nguc",
  QL: "quan-lot",
  QG: "quan-gen",
};

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

function normalizeForMatch(value) {
  return String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function isYearLike(candidate) {
  const number = Number(candidate);
  return Number.isInteger(number) && number >= YEAR_MIN && number <= YEAR_MAX;
}

function inferModelIdentity(relativePath) {
  const segments = relativePath.split(/[\\/]/).filter(Boolean);

  // Prefix nghiệp vụ trong tên thư mục/file là nguồn chắc chắn nhất.
  for (const segment of segments) {
    const matches = segment.matchAll(
      /(?:^|[^a-z0-9])(AL|QL|QG)[\s_-]*(\d{3,5})(?=$|[^0-9])/gi,
    );

    for (const match of matches) {
      return {
        modelCode: match[2],
        productPrefix: match[1].toUpperCase(),
        source: `path-prefix-${match[1].toUpperCase()}`,
      };
    }
  }

  // Fallback cho folder chỉ có mã số. Loại kích thước ảnh và năm/timestamp.
  for (const segment of segments) {
    const matches = segment.matchAll(/(?:^|\D)(\d{4})(?=\D|$)/g);

    for (const match of matches) {
      const candidate = match[1];

      if (RESERVED_NUMBER_TOKENS.has(candidate)) continue;
      if (isYearLike(candidate)) continue;

      return {
        modelCode: candidate,
        productPrefix: null,
        source: "bare-model-number",
      };
    }
  }

  return null;
}

function findModelRule(modelCode) {
  return MODEL_RULES.find((rule) => modelCode.startsWith(rule.prefix)) ?? null;
}

function inferBrand(relativePath, brandHint, modelCode) {
  const normalized = normalizeForMatch(relativePath);

  if (/(^|[^a-z])(pensee|ps)([^a-z]|$)/i.test(normalized)) {
    return { value: "pensee", source: "path" };
  }

  if (/(^|[^a-z])(winking|wk)([^a-z]|$)/i.test(normalized)) {
    return { value: "winking", source: "path" };
  }

  if (brandHint) {
    return { value: brandHint, source: "source-folder" };
  }

  const rule = findModelRule(modelCode);
  if (rule) {
    return { value: rule.brand, source: `model-prefix-${rule.prefix}` };
  }

  return { value: "unclassified", source: "unclassified" };
}

function inferCategory(relativePath, categoryHint, modelIdentity) {
  const explicitPrefix = modelIdentity.productPrefix;

  if (explicitPrefix && PRODUCT_PREFIX_RULES[explicitPrefix]) {
    return {
      value: PRODUCT_PREFIX_RULES[explicitPrefix],
      source: `path-prefix-${explicitPrefix}`,
    };
  }

  const normalized = normalizeForMatch(relativePath).replace(/\\/g, "/");

  if (/(^|[^a-z])(quan[\s_-]*gen|gen[\s_-]*(bung|eo))([^a-z]|$)/i.test(normalized)) {
    return { value: "quan-gen", source: "path-text" };
  }

  if (/(^|[^a-z])(quan[\s_-]*lot|quanlot)([^a-z]|$)/i.test(normalized)) {
    return { value: "quan-lot", source: "path-text" };
  }

  if (/(^|[^a-z])(ao[\s_-]*nguc|aonguc)([^a-z]|$)/i.test(normalized)) {
    return { value: "ao-nguc", source: "path-text" };
  }

  // Folder nguồn QL là tín hiệu mạnh hơn đầu mã; QG ở trên đã được ưu tiên.
  if (categoryHint) {
    return { value: categoryHint, source: "source-folder" };
  }

  const rule = findModelRule(modelIdentity.modelCode);
  if (rule) {
    return { value: rule.category, source: `model-prefix-${rule.prefix}` };
  }

  return { value: "unclassified", source: "unclassified" };
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

function summarizeGroups(products, key) {
  const report = new Map();

  for (const product of products) {
    const name = product[key];
    const current = report.get(name) ?? { productCount: 0, imageCount: 0 };
    current.productCount += 1;
    current.imageCount += product.images.length;
    report.set(name, current);
  }

  return Object.fromEntries(
    [...report.entries()].sort(([left], [right]) =>
      left.localeCompare(right, "vi"),
    ),
  );
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
    const modelIdentity = inferModelIdentity(file.relativePath);
    const image = {
      source: source.name,
      relativeToSource: normalizePath(file.relativePath),
      relativeToTtRoot: normalizePath(path.relative(ttRoot, file.absolutePath)),
      folderRelativeToSource: normalizePath(path.dirname(file.relativePath)),
      fileName: file.fileName,
      extension: file.extension,
      sizeBytes: file.sizeBytes,
      modifiedAt: file.modifiedAt,
    };

    if (!modelIdentity) {
      unmatchedFiles.push({
        ...image,
        reason:
          "Không tìm thấy tiền tố AL/QL/QG hoặc mã model hợp lệ; số năm và kích thước ảnh đã bị loại.",
      });
      continue;
    }

    const brandResult = inferBrand(
      file.relativePath,
      source.brandHint,
      modelIdentity.modelCode,
    );
    const categoryResult = inferCategory(
      file.relativePath,
      source.categoryHint,
      modelIdentity,
    );

    const groupKey = `${brandResult.value}:${categoryResult.value}:${modelIdentity.modelCode}`;
    const current = productGroups.get(groupKey) ?? {
      brand: brandResult.value,
      category: categoryResult.value,
      modelCode: modelIdentity.modelCode,
      productPrefixes: new Set(),
      modelSources: new Set(),
      brandSources: new Set(),
      categorySources: new Set(),
      sources: new Set(),
      folders: new Set(),
      images: [],
    };

    if (modelIdentity.productPrefix) {
      current.productPrefixes.add(modelIdentity.productPrefix);
    }
    current.modelSources.add(modelIdentity.source);
    current.brandSources.add(brandResult.source);
    current.categorySources.add(categoryResult.source);
    current.sources.add(source.name);
    current.folders.add(image.folderRelativeToSource);
    current.images.push(image);
    productGroups.set(groupKey, current);
  }
}

const products = [...productGroups.values()]
  .map((product) => ({
    ...product,
    productPrefixes: [...product.productPrefixes].sort(),
    modelSources: [...product.modelSources].sort(),
    brandSources: [...product.brandSources].sort(),
    categorySources: [...product.categorySources].sort(),
    sources: [...product.sources].sort(),
    folders: [...product.folders].sort((left, right) =>
      left.localeCompare(right, "vi"),
    ),
    images: product.images.sort((left, right) =>
      left.relativeToTtRoot.localeCompare(right.relativeToTtRoot, "vi"),
    ),
  }))
  .sort((left, right) => {
    const brandCompare = left.brand.localeCompare(right.brand, "vi");
    if (brandCompare !== 0) return brandCompare;

    const categoryCompare = left.category.localeCompare(right.category, "vi");
    if (categoryCompare !== 0) return categoryCompare;

    return left.modelCode.localeCompare(right.modelCode, "vi");
  });

const classificationWarnings = products
  .filter(
    (product) =>
      product.brand === "unclassified" ||
      product.category === "unclassified" ||
      product.modelSources.includes("bare-model-number"),
  )
  .map((product) => ({
    brand: product.brand,
    category: product.category,
    modelCode: product.modelCode,
    productPrefixes: product.productPrefixes,
    modelSources: product.modelSources,
    brandSources: product.brandSources,
    categorySources: product.categorySources,
    folders: product.folders,
    imageCount: product.images.length,
  }));

const manifest = {
  schemaVersion: 3,
  generatedAt: new Date().toISOString(),
  ttRoot,
  outputFile,
  classificationRules: {
    productPrefixes: PRODUCT_PREFIX_RULES,
    modelPrefixes: MODEL_RULES,
    ignoredYearRange: [YEAR_MIN, YEAR_MAX],
    priority: [
      "AL/QL/QG prefix determines category and model",
      "path/source folder determines brand when explicit",
      "QL source folder determines quan-lot unless QG is present",
      "model prefix determines remaining brand/category",
      "bare four-digit model is accepted only when it is not a year or image size",
    ],
  },
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
    classificationWarningCount: classificationWarnings.length,
    byBrand: summarizeGroups(products, "brand"),
    byCategory: summarizeGroups(products, "category"),
  },
  sources: sourceReports,
  products,
  unmatchedFiles: unmatchedFiles.sort((left, right) =>
    left.relativeToTtRoot.localeCompare(right.relativeToTtRoot, "vi"),
  ),
  classificationWarnings,
};

await fs.mkdir(path.dirname(outputFile), { recursive: true });
await fs.writeFile(outputFile, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

console.log(`Đã tạo manifest: ${outputFile}`);
console.log(
  `Model: ${manifest.summary.productGroupCount} | ` +
    `Ảnh khớp: ${manifest.summary.matchedImageCount} | ` +
    `Ảnh chưa khớp: ${manifest.summary.unmatchedImageCount} | ` +
    `Cảnh báo phân loại: ${manifest.summary.classificationWarningCount}`,
);
console.log("Theo thương hiệu:", manifest.summary.byBrand);
console.log("Theo nhóm:", manifest.summary.byCategory);

for (const source of sourceReports.filter((item) => !item.exists)) {
  console.warn(`Không tìm thấy thư mục nguồn: ${source.root}`);
}

if (!manifest.priceFile.exists) {
  console.warn(`Không tìm thấy file bảng giá: ${priceFile}`);
}
