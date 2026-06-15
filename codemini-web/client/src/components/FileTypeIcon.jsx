import { useEffect, useState } from "react";
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

function getFileName(path = "") {
  return (
    String(path || "")
      .replace(/\\/g, "/")
      .split("/")
      .filter(Boolean)
      .pop() || ""
  ).split(/[?#]/)[0];
}

function getExtensionIconName(fileName = "", iconMap = FALLBACK_ICON_MAP) {
  const value = String(fileName || "").toLowerCase();
  const dotIndexes = [];
  for (let i = 0; i < value.length; i += 1) {
    if (value[i] === "." && i > 0 && i < value.length - 1) dotIndexes.push(i);
  }
  for (const dotIndex of dotIndexes) {
    const extension = value.slice(dotIndex + 1);
    const iconName = iconMap.fileExtensions[extension];
    if (iconName) return iconName;
  }
  return "";
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

  const fileName = getFileName(path).toLowerCase();
  const iconName =
    iconMap.fileNames[fileName] ||
    getExtensionIconName(fileName, iconMap) ||
    iconMap.defaultFileIcon;
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
