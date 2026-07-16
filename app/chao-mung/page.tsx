import Link from "next/link";

import { InstallAppButton } from "@/components/app-shell/install-app-button";

import styles from "./welcome-balance.module.css";

export default function WelcomePage() {
  return (
    <main className={`fashion-welcome ${styles.page}`}>
      <div className="fashion-welcome__backdrop" aria-hidden="true" />

      <section className={`fashion-welcome__brand ${styles.brand}`}>
        <img
          src="/brand/pensee-logo-current.png"
          alt="Pensee"
          className={`fashion-welcome__logo ${styles.logo}`}
        />
        <p className={`fashion-welcome__slogan ${styles.slogan}`}>
          Nội y tôn vinh vẻ đẹp và sự tự tin của bạn.
        </p>
      </section>

      <section
        className={`fashion-welcome__visual ${styles.visual}`}
        aria-label="Bộ sưu tập Pensee"
      >
        <img
          src="/brand/pensee-welcome-current.png"
          alt="Bộ sưu tập nội y Pensee"
          className={`fashion-welcome__hero-image ${styles.heroImage}`}
        />
        <div className="fashion-welcome__mist" aria-hidden="true" />
      </section>

      <section className={`fashion-welcome__panel ${styles.panel}`}>
        <div className={`fashion-welcome__actions ${styles.actions}`}>
          <Link
            href="/dang-nhap?callbackUrl=/tai-khoan"
            className="fashion-welcome__primary"
          >
            <span>Đăng nhập</span>
            <svg aria-hidden="true" viewBox="0 0 24 24">
              <path d="M5 12h14M14 7l5 5-5 5" />
            </svg>
          </Link>

          <Link href="/cua-hang" className="fashion-welcome__secondary">
            <svg aria-hidden="true" viewBox="0 0 24 24">
              <path d="M5 5.5h14v15H5z" />
              <path d="M8 5.5a4 4 0 0 1 8 0" />
            </svg>
            <span>Sản phẩm</span>
            <svg aria-hidden="true" viewBox="0 0 24 24">
              <path d="M5 12h14M14 7l5 5-5 5" />
            </svg>
          </Link>

          <InstallAppButton />
        </div>
      </section>
    </main>
  );
}
