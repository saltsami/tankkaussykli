import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "TankkausSykli",
    short_name: "TankkausSykli",
    description: "Lähialueen polttoainehinnat ja hintatrendi.",
    start_url: "/",
    display: "standalone",
    background_color: "#f4f7f5",
    theme_color: "#0b3b36",
    lang: "fi",
    icons: [
      {
        src: "/app-icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
    ],
  };
}
