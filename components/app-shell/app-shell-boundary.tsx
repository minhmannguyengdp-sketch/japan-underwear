"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

type NavItem = {
  href: string;
  label: string;
  match: (pathname: string) => boolean;
  icon: ReactNode;
};

const navItems: NavItem[] = [
  {
    href: "/",
    label: "Trang chủ",
    match: (pathname) => pathname === "/",
    icon: (
      <svg aria-hidden="true" viewBox="0 0 24 24">
        <path d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-5v-6h-4v6H5a1 1 0 0 1-1-1v-9.5Z" />
      </svg>
    ),
  },
  {
    href: "/cua-hang",
    label: "Sản phẩm",
    match: (pathname) => pathname.startsWith("/cua-hang"),
    icon: (
      <svg aria-hidden="true" viewBox="0 0 24 24">
        <path d="M5 5.5h14v15H5z" />
        <path d="M8 5.5a4 4 0 0 1 8 0M8 10h.01M16 10h.01" />
      </svg>
    ),
  },
  {
    href: "/su-kien",
    label: "Sự kiện",
    match: (pathname) => pathname.startsWith("/su-kien"),
    icon: (
      <svg aria-hidden="true" viewBox="0 0 24 24">
        <path d="M5 4h14v16H5zM8 2v4M16 2v4M5 9h14" />
        <path d="m9 14 2 2 4-4" />
      </svg>
    ),
  },
  {
    href: "/don-hang",
    label: "Đơn hàng",
    match: (pathname) => pathname.startsWith("/don-hang"),
    icon: (
      <svg aria-hidden="true" viewBox="0 0 24 24">
        <path d="M6 3h12v18H6zM9 8h6M9 12h6M9 16h4" />
      </svg>
    ),
  },
  {
    href: "/tai-khoan",
    label: "Tài khoản",
    match: (pathname) => pathname.startsWith("/tai-khoan") || pathname.startsWith("/dang-nhap"),
    icon: (
      <svg aria-hidden="true" viewBox="0 0 24 24">
        <circle cx="12" cy="8" r="4" />
        <path d="M4.5 21a7.5 7.5 0 0 1 15 0" />
      </svg>
    ),
  },
];

const routeTitles: Array<{
  match: (pathname: string) => boolean;
  title: string;
}> = [
  { match: (pathname) => pathname.startsWith("/cua-hang"), title: "Sản phẩm" },
  { match: (pathname) => pathname.startsWith("/su-kien"), title: "Sự kiện" },
  { match: (pathname) => pathname.startsWith("/don-hang"), title: "Đơn hàng" },
  {
    match: (pathname) =>
      pathname.startsWith("/tai-khoan") || pathname.startsWith("/dang-nhap"),
    title: "Tài khoản",
  },
  { match: () => true, title: "Tuấn Thủy" },
];

export function AppShellBoundary({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  if (pathname.startsWith("/admin")) return children;

  if (pathname === "/chao-mung") {
    return (
      <div className="app-stage">
        <div className="public-app-shell public-app-shell--welcome">{children}</div>
      </div>
    );
  }

  const routeTitle =
    routeTitles.find((item) => item.match(pathname)) ?? routeTitles[routeTitles.length - 1];

  return (
    <div className="app-stage">
      <div className="public-app-shell" data-route={pathname}>
        <header className="public-app-header">
          <Link href="/" className="public-brand" aria-label="Về trang chủ Tuấn Thủy">
            <span className="public-brand-logo">
              <img src="/brand/pensee-logo-current.png" alt="" />
            </span>
            <span className="public-brand-copy">
              <strong>{routeTitle.title}</strong>
            </span>
          </Link>
          <Link href="/tai-khoan" className="public-account-button" aria-label="Mở tài khoản">
            <svg aria-hidden="true" viewBox="0 0 24 24">
              <circle cx="12" cy="8" r="4" />
              <path d="M5 21a7 7 0 0 1 14 0" />
            </svg>
          </Link>
        </header>

        <div className="public-app-canvas">{children}</div>

        <nav className="public-bottom-nav" aria-label="Điều hướng chính">
          {navItems.map((item) => {
            const active = item.match(pathname);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={active ? "is-active" : undefined}
                aria-current={active ? "page" : undefined}
              >
                {item.icon}
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>
      </div>
    </div>
  );
}
