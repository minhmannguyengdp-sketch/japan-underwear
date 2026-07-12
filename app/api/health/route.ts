import { NextResponse } from "next/server";

export function GET() {
  return NextResponse.json({
    status: "ok",
    service: "japan-underwear",
    timestamp: new Date().toISOString(),
  });
}
