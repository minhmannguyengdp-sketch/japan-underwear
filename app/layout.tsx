import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "Tuấn Thủy | Catalog bán sỉ",
  description: "Catalog Winking và Pensee với gallery thật từ Cloudflare R2.",
  applicationName: "Tuấn Thủy Catalog",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="vi">
      <body>{children}</body>
    </html>
  );
}
