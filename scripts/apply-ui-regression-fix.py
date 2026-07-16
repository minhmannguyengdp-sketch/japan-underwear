from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file = Path(path)
    text = file.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected one match, found {count}")
    file.write_text(text.replace(old, new, 1), encoding="utf-8")


replace_once(
    "app/chao-mung/page.tsx",
    'src="/brand/pensee-logo-transparent.svg"',
    'src="/brand/pensee-logo-current.png"',
)
replace_once(
    "app/chao-mung/page.tsx",
    '''        />
      </section>

      <section className="fashion-welcome__visual"''',
    '''        />
        <p className="fashion-welcome__slogan">
          Nội y tôn vinh vẻ đẹp và sự tự tin của bạn.
        </p>
      </section>

      <section className="fashion-welcome__visual"''',
)

replace_once(
    "components/app-shell/app-shell-boundary.tsx",
    'src="/brand/pensee-logo-transparent.svg"',
    'src="/brand/pensee-logo-current.png"',
)

replace_once(
    "components/catalog-ordering-v2.tsx",
    '''  function scrollGalleryTo(index: number) {
    const gallery = galleryRef.current;
    if (!gallery) return;
    gallery.scrollTo({ left: gallery.clientWidth * index, behavior: "smooth" });
  }''',
    '''  function scrollGalleryTo(index: number) {
    const gallery = galleryRef.current;
    if (!gallery) return;
    setImageIndex(index);
    gallery.scrollTo({ left: gallery.clientWidth * index, behavior: "smooth" });
  }''',
)
replace_once(
    "components/catalog-ordering-v2.tsx",
    '''                {selected.images.length > 1 ? (
                  <div className="product-gallery__dots" aria-label="Vị trí ảnh">
                    {selected.images.map((image, index) => (
                      <button
                        key={image.id}
                        type="button"
                        className={index === imageIndex ? "is-active" : undefined}
                        onClick={() => scrollGalleryTo(index)}
                        aria-label={`Ảnh ${index + 1}`}
                      />
                    ))}
                  </div>
                ) : null}''',
    '''                {selected.images.length > 1 ? (
                  <div className="product-gallery__thumbs no-scrollbar" aria-label="Chọn ảnh sản phẩm">
                    {selected.images.map((image, index) => (
                      <button
                        key={image.id}
                        type="button"
                        className={index === imageIndex ? "is-active" : undefined}
                        onClick={() => scrollGalleryTo(index)}
                        aria-label={`Xem ảnh ${index + 1}`}
                        aria-current={index === imageIndex ? "true" : undefined}
                      >
                        {image.src ? <img src={image.src} alt="" /> : <span>{index + 1}</span>}
                      </button>
                    ))}
                  </div>
                ) : null}''',
)

replace_once(
    "app/storefront-polish.css",
    '''  border-bottom-color: rgba(255, 255, 255, 0.18);
  background:
    linear-gradient(135deg, rgba(119, 47, 146, 0.88), rgba(75, 20, 96, 0.76));
  box-shadow: 0 8px 22px rgba(55, 15, 70, 0.16);
  backdrop-filter: blur(20px) saturate(1.25);''',
    '''  border-bottom-color: rgba(255, 255, 255, 0.2);
  background:
    linear-gradient(135deg, rgba(119, 47, 146, 0.54), rgba(75, 20, 96, 0.36));
  box-shadow: 0 8px 22px rgba(55, 15, 70, 0.1);
  -webkit-backdrop-filter: blur(24px) saturate(1.35);
  backdrop-filter: blur(24px) saturate(1.35);''',
)
replace_once(
    "app/storefront-polish.css",
    '''.public-brand-logo {
  width: 30px;
  height: 30px;
}

.public-brand-logo img,
.fashion-welcome__logo {
  mix-blend-mode: normal !important;
}''',
    '''.public-brand-logo {
  width: 32px;
  height: 32px;
  overflow: hidden;
  border: 1px solid rgba(255, 255, 255, 0.34);
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.74);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.5);
}

.public-brand-logo img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  transform: scale(1.12);
  mix-blend-mode: multiply !important;
}

.fashion-welcome__logo {
  mix-blend-mode: multiply !important;
}''',
)
replace_once(
    "app/storefront-polish.css",
    '''  border-top-color: rgba(255, 255, 255, 0.18);
  background:
    linear-gradient(135deg, rgba(103, 36, 129, 0.9), rgba(65, 16, 84, 0.8));
  box-shadow: 0 -9px 25px rgba(49, 11, 63, 0.16);
  backdrop-filter: blur(20px) saturate(1.25);''',
    '''  border-top-color: rgba(255, 255, 255, 0.2);
  background:
    linear-gradient(135deg, rgba(103, 36, 129, 0.56), rgba(65, 16, 84, 0.38));
  box-shadow: 0 -9px 25px rgba(49, 11, 63, 0.1);
  -webkit-backdrop-filter: blur(24px) saturate(1.35);
  backdrop-filter: blur(24px) saturate(1.35);''',
)
replace_once(
    "app/storefront-polish.css",
    '''.fashion-welcome__brand {
  min-height: 62px;
}

.fashion-welcome__logo {
  width: clamp(142px, 42vw, 176px);
  height: 62px;
  filter: drop-shadow(0 8px 16px rgba(73, 28, 87, 0.08));
}

.fashion-welcome__visual {
  min-height: 250px;
  flex: 1 1 330px;
  margin-top: 2px;
  border-radius: 28px;
}''',
    '''.fashion-welcome__brand {
  min-height: 84px;
}

.fashion-welcome__logo {
  width: clamp(146px, 44vw, 184px);
  height: 58px;
  object-fit: contain;
  filter: drop-shadow(0 8px 16px rgba(73, 28, 87, 0.08));
}

.fashion-welcome__slogan {
  max-width: 310px;
  margin: 2px auto 0;
  color: #6d5573;
  font-family: Georgia, "Times New Roman", serif;
  font-size: 13px;
  line-height: 1.35;
  text-align: center;
}

.fashion-welcome__visual {
  height: clamp(230px, 43dvh, 330px);
  min-height: 0;
  flex: 0 1 auto;
  margin: 4px 0 0;
  border-radius: 26px;
}

.fashion-welcome__hero-image {
  width: 100%;
  height: 100%;
  min-height: 0;
  object-fit: contain;
  object-position: center;
  transform: none;
}''',
)
replace_once(
    "app/storefront-polish.css",
    '''.fashion-welcome__panel {
  margin: -22px 3px 0;''',
    '''.fashion-welcome__panel {
  margin: -12px 3px 0;''',
)
replace_once(
    "app/storefront-polish.css",
    '''.product-gallery__dots {
  display: flex;
  min-height: 24px;
  align-items: center;
  justify-content: center;
  gap: 5px;
  padding-top: 7px;
}

.product-gallery__dots button {
  width: 6px;
  height: 6px;
  padding: 0;
  border: 0;
  border-radius: 999px;
  background: rgba(102, 54, 115, 0.24);
  transition: width 150ms ease, background 150ms ease;
}

.product-gallery__dots button.is-active {
  width: 18px;
  background: #732b8b;
}''',
    '''.product-gallery__thumbs {
  display: flex;
  gap: 8px;
  overflow-x: auto;
  padding: 9px 2px 3px;
  scroll-snap-type: x proximity;
}

.product-gallery__thumbs button {
  display: grid;
  width: 54px;
  height: 54px;
  flex: 0 0 54px;
  overflow: hidden;
  padding: 2px;
  place-items: center;
  border: 1px solid rgba(100, 54, 113, 0.18);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.86);
  color: #7b6980;
  scroll-snap-align: start;
  transition: border-color 150ms ease, box-shadow 150ms ease, transform 150ms ease;
}

.product-gallery__thumbs button img {
  width: 100%;
  height: 100%;
  border-radius: 9px;
  object-fit: contain;
}

.product-gallery__thumbs button.is-active {
  border-color: #732b8b;
  box-shadow: 0 0 0 2px rgba(115, 43, 139, 0.14);
  transform: translateY(-1px);
}''',
)
replace_once(
    "app/storefront-polish.css",
    '''  .fashion-welcome__visual {
    min-height: 220px;
  }''',
    '''  .fashion-welcome__visual {
    height: 220px;
    min-height: 0;
  }''',
)
replace_once(
    "app/storefront-polish.css",
    '''  .fashion-welcome__brand {
    min-height: 52px;
  }

  .fashion-welcome__logo {
    width: 128px;
    height: 52px;
  }

  .fashion-welcome__visual {
    min-height: 190px;
    margin-top: 0;
  }''',
    '''  .fashion-welcome__brand {
    min-height: 68px;
  }

  .fashion-welcome__logo {
    width: 132px;
    height: 46px;
  }

  .fashion-welcome__slogan {
    font-size: 11px;
  }

  .fashion-welcome__visual {
    height: 190px;
    min-height: 0;
    margin-top: 0;
  }''',
)

replace_once("public/sw.js", 'tuan-thuy-shell-v8', 'tuan-thuy-shell-v9')
replace_once(
    "public/sw.js",
    '  "/brand/pensee-logo-transparent.svg",\n',
    '',
)
