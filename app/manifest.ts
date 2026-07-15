import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Tuấn Thủy - Đặt hàng sỉ",
    short_name: "Tuấn Thủy",
    description: "Ứng dụng đặt hàng sỉ Pensee và Winking.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#f7f1fa",
    theme_color: "#5f267f",
    lang: "vi",
    icons: [
      {
        src: "/brand/pensee-logo.png",
        sizes: "any",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/brand/pensee-logo.png",
        sizes: "any",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
