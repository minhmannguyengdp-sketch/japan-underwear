"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

const links = [
  { href: "/admin", label: "Đơn hàng", exact: true },
  { href: "/admin/tao-don", label: "Tạo đơn", exact: false },
  { href: "/admin/khach-hang", label: "Khách hàng", exact: false },
  { href: "/admin/catalog", label: "Catalog", exact: false },
];

export function AdminAppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="admin-app-stage">
      <div className="admin-app-shell">
        <header className="admin-app-header">
          <Link href="/admin" className="admin-brand">
            <span className="admin-brand-logo">
              <img src="/brand/pensee-logo.png" alt="" />
            </span>
            <span>
              <strong>Tuấn Thủy</strong>
              <small>Sales / Admin</small>
            </span>
          </Link>

          <nav aria-label="Điều hướng nội bộ">
            {links.map((item) => {
              const active = item.exact
                ? pathname === item.href
                : pathname.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={active ? "is-active" : undefined}
                  aria-current={active ? "page" : undefined}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </header>

        <div className="admin-app-content">{children}</div>
      </div>
    </div>
  );
}
