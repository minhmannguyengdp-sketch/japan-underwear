import { NextRequest, NextResponse } from "next/server";

import { listCatalogProducts } from "@/lib/catalog";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const rawLimit = Number(searchParams.get("limit") ?? "200");

  try {
    const products = await listCatalogProducts({
      q: searchParams.get("q") ?? undefined,
      brand: searchParams.get("brand") ?? undefined,
      category: searchParams.get("category") ?? undefined,
      limit: Number.isFinite(rawLimit) ? rawLimit : 200,
    });

    return NextResponse.json({
      count: products.length,
      products,
    });
  } catch (error) {
    console.error(
      "Catalog API failed:",
      error instanceof Error ? error.message : String(error),
    );

    return NextResponse.json(
      { error: "Không đọc được catalog từ PostgreSQL." },
      { status: 500 },
    );
  }
}
