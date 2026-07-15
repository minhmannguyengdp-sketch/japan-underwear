import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

import { AppShellBoundary } from "@/components/app-shell/app-shell-boundary";
import { PwaRuntime } from "@/components/app-shell/pwa-runtime";

import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Tuấn Thủy | Đặt hàng sỉ",
    template: "%s | Tuấn Thủy",
  },
  description: "Ứng dụng đặt hàng sỉ Pensee và Winking của Tuấn Thủy.",
  applicationName: "Tuấn Thủy",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Tuấn Thủy",
  },
  icons: {
    icon: "/brand/pensee-logo.png",
    apple: "/brand/pensee-logo.png",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: "#5f267f",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="vi">
      <body>
        <PwaRuntime />
        <AppShellBoundary>{children}</AppShellBoundary>
      </body>
    </html>
  );
}
