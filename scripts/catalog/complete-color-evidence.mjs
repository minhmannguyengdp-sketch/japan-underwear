const COMPLETENESS_EVIDENCE_TYPES = new Set([
  "explicit-public-color-list",
  "supplier-confirmed-color-list",
]);

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();

function requireCompleteProductEvidence(product, key, evidence) {
  if (evidence?.colorSetComplete !== true) {
    throw new Error(`Product ${key} chưa xác nhận bộ màu đầy đủ.`);
  }

  const evidenceTypes = (evidence.completenessEvidenceTypes ?? []).map(clean).filter(Boolean);
  const evidenceTexts = (evidence.completenessEvidenceTexts ?? []).map(clean).filter(Boolean);
  const evidenceUrls = (evidence.completenessEvidenceUrls ?? []).map(clean).filter(Boolean);

  if (!evidenceTypes.some((type) => COMPLETENESS_EVIDENCE_TYPES.has(type))) {
    throw new Error(
      `Product ${key} thiếu danh sách màu đầy đủ từ website hoặc xác nhận của nhà cung cấp.`,
    );
  }
  if (evidenceTexts.length === 0 || evidenceUrls.length === 0) {
    throw new Error(`Product ${key} thiếu nội dung hoặc URL chứng minh bộ màu đầy đủ.`);
  }
}

export function validateCompleteColorEvidence(payload, stage) {
  if (!payload || payload.schemaVersion !== 1) {
    throw new Error(`Dữ liệu ${stage} không hợp lệ hoặc sai schemaVersion.`);
  }

  const rules = stage === "approved" ? payload.approval : payload.businessRules;
  if (!rules?.observedImagesAloneDoNotProveCompleteness) {
    throw new Error(
      "Ảnh quan sát chỉ chứng minh màu nhìn thấy; không được dùng để kết luận bộ màu đầy đủ.",
    );
  }
  if (!rules?.colorSetCompletenessVerified) {
    throw new Error(
      "Chưa xác minh bộ màu đầy đủ. Một ảnh sản phẩm không đủ để kết luận sản phẩm chỉ có một màu.",
    );
  }

  let products;
  let completeCount;
  if (stage === "decisions") {
    products = payload.products ?? [];
    completeCount = Number(payload.summary?.completeColorSetProductCount);
    if (products.length !== 30 || completeCount !== 30) {
      throw new Error("Decisions phải có đúng 30 product được xác minh bộ màu đầy đủ.");
    }
    for (const product of products) {
      const key = clean(product.key);
      requireCompleteProductEvidence(product, key, product);
    }
    return;
  }

  if (stage === "review") {
    products = payload.candidateProducts ?? [];
    completeCount = Number(payload.summary?.completeColorSetProductCount);
    if (products.length !== 30 || completeCount !== 30) {
      throw new Error("Review phải có đúng 30 product được xác minh bộ màu đầy đủ.");
    }
    for (const product of products) {
      const key = clean(product.key);
      requireCompleteProductEvidence(product, key, product.reviewEvidence);
    }
    return;
  }

  if (stage === "approved") {
    products = payload.approvedProducts ?? [];
    if (products.length !== 30) {
      throw new Error("Approved colors phải có đúng 30 product.");
    }
    for (const product of products) {
      const key = clean(product.key);
      requireCompleteProductEvidence(product, key, product.reviewEvidence);
    }
    return;
  }

  throw new Error(`Stage kiểm chứng không hợp lệ: ${stage}`);
}
