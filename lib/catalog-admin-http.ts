import { NextResponse } from "next/server";

import { AuthorizationError } from "@/lib/authz";
import { CatalogAdminError } from "@/lib/catalog-admin";

export function catalogAdminApiErrorResponse(error: unknown) {
  if (error instanceof AuthorizationError) {
    return NextResponse.json(
      { error: error.message, code: error.code },
      { status: error.status },
    );
  }

  if (error instanceof CatalogAdminError) {
    return NextResponse.json(
      { error: error.message, code: error.code },
      { status: error.status },
    );
  }

  console.error(
    "Catalog admin API failed:",
    error instanceof Error ? error.message : String(error),
  );
  return NextResponse.json(
    { error: "Không xử lý được yêu cầu quản lý catalog.", code: "internal_error" },
    { status: 500 },
  );
}
