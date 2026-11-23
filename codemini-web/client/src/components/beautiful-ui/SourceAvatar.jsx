import { useState } from "react";
import { LinkSimple } from "@/lib/icons";
import { BrandLogo, faviconUrl, getEmbedBrand } from "@/lib/embed-branding.jsx";

export function sourceDomain(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

export function SourceAvatar({ url, type }) {
  const brand = getEmbedBrand(type, url);
  const [failedUrl, setFailedUrl] = useState("");
  const image = brand.key === "link" && failedUrl !== url ? faviconUrl(url) : null;

  return (
    <span
      className="codemini-source-avatar"
      style={{ background: brand.iconBg, color: brand.iconColor }}
      aria-hidden="true"
    >
      {brand.key !== "link" ? <BrandLogo brandKey={brand.key} size={13} /> : <LinkSimple size={13} />}
      {image && <img src={image} alt="" loading="lazy" onError={() => setFailedUrl(url)} />}
    </span>
  );
}
