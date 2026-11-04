import { useEffect, useState } from "react";
import { resolveFileTypeIconName } from "@/lib/file-type-icon.js";
import { cn } from "@/lib/utils";

const ICON_BASE_PATH = "/icons/material";
const ICON_MAP_PATH = `${ICON_BASE_PATH}/material-icon-map.json`;
const FALLBACK_ICON_MAP = {
  defaultFileIcon: "file",
  fileExtensions: {},
  fileNames: {},
};

let cachedIconMap = null;
let iconMapPromise = null;

function loadIconMap() {
  if (cachedIconMap) return Promise.resolve(cachedIconMap);
  if (!iconMapPromise) {
    iconMapPromise = fetch(ICON_MAP_PATH)
      .then((response) => (response.ok ? response.json() : FALLBACK_ICON_MAP))
      .then((map) => {
        cachedIconMap = {
          defaultFileIcon:
            map?.defaultFileIcon || FALLBACK_ICON_MAP.defaultFileIcon,
          fileExtensions:
            map?.fileExtensions && typeof map.fileExtensions === "object"
              ? map.fileExtensions
              : FALLBACK_ICON_MAP.fileExtensions,
          fileNames:
            map?.fileNames && typeof map.fileNames === "object"
              ? map.fileNames
              : FALLBACK_ICON_MAP.fileNames,
        };
        return cachedIconMap;
      })
      .catch(() => FALLBACK_ICON_MAP);
  }
  return iconMapPromise;
}

export function FileTypeIcon({ path, className, size = "md" }) {
  const [iconMap, setIconMap] = useState(cachedIconMap || FALLBACK_ICON_MAP);

  useEffect(() => {
    if (cachedIconMap) return undefined;
    let active = true;
    loadIconMap().then((map) => {
      if (active) setIconMap(map);
    });
    return () => {
      active = false;
    };
  }, []);

  const iconName = resolveFileTypeIconName(path, iconMap);
  const sizeClass = size === "sm" ? "size-4" : "size-5";

  return (
    <img
      src={`${ICON_BASE_PATH}/${iconName}.svg`}
      alt=""
      className={cn(
        "inline-block shrink-0 object-contain",
        sizeClass,
        className,
      )}
      aria-hidden="true"
      loading="lazy"
    />
  );
}
