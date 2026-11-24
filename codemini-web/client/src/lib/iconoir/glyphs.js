// Iconoir v7.11.1 regular glyphs. See LICENSE.
import { createElement, forwardRef } from "react";

function icon(...shapes) {
  return forwardRef(function IconoirIcon({ size = 24, color = "currentColor", stroke = 1.5, strokeWidth = stroke, ...props }, ref) {
    return createElement("svg", {
      ref, width: size, height: size, viewBox: "0 0 24 24", fill: "none",
      color, strokeWidth, ...props,
    }, ...shapes);
  });
}

export const LinkIcon = icon(
  createElement("path", { d: "M14 11.9976C14 9.5059 11.683 7 8.85714 7C8.52241 7 7.41904 7.00001 7.14286 7.00001C4.30254 7.00001 2 9.23752 2 11.9976C2 14.376 3.70973 16.3664 6 16.8714C6.36756 16.9525 6.75006 16.9952 7.14286 16.9952", stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round" }),
  createElement("path", { d: "M10 11.9976C10 14.4893 12.317 16.9952 15.1429 16.9952C15.4776 16.9952 16.581 16.9952 16.8571 16.9952C19.6975 16.9952 22 14.7577 22 11.9976C22 9.6192 20.2903 7.62884 18 7.12383C17.6324 7.04278 17.2499 6.99999 16.8571 6.99999", stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round" }),
);

export const GlobeIcon = icon(
  createElement("path", { d: "M12 22C17.5228 22 22 17.5228 22 12C22 6.47715 17.5228 2 12 2C6.47715 2 2 6.47715 2 12C2 17.5228 6.47715 22 12 22Z", stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round" }),
  createElement("path", { d: "M2.5 12.5L8 14.5L7 18L8 21", stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round" }),
  createElement("path", { d: "M17 20.5L16.5 18L14 17V13.5L17 12.5L21.5 13", stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round" }),
  createElement("path", { d: "M19 5.5L18.5 7L15 7.5V10.5L17.5 9.5H19.5L21.5 10.5", stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round" }),
  createElement("path", { d: "M2.5 10.5L5 8.5L7.5 8L9.5 5L8.5 3", stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round" }),
);

export const NavArrowDownIcon = icon(
  createElement("path", { d: "M6 9L12 15L18 9", stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round" }),
);

export const NavArrowLeftIcon = icon(
  createElement("path", { d: "M15 6L9 12L15 18", stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round" }),
);

export const NavArrowRightIcon = icon(
  createElement("path", { d: "M9 6L15 12L9 18", stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round" }),
);

export const NavArrowUpIcon = icon(
  createElement("path", { d: "M6 15L12 9L18 15", stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round" }),
);

export const ArrowDownIcon = icon(
  createElement("path", { d: "M12 3L12 21M12 21L20.5 12.5M12 21L3.5 12.5", stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round" }),
);

export const ArrowLeftIcon = icon(
  createElement("path", { d: "M21 12L3 12M3 12L11.5 3.5M3 12L11.5 20.5", stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round" }),
);

export const ArrowRightIcon = icon(
  createElement("path", { d: "M3 12L21 12M21 12L12.5 3.5M21 12L12.5 20.5", stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round" }),
);

export const ArrowUpIcon = icon(
  createElement("path", { d: "M12 21L12 3M12 3L20.5 11.5M12 3L3.5 11.5", stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round" }),
);

export const RefreshIcon = icon(
  createElement("path", { d: "M21.8883 13.5C21.1645 18.3113 17.013 22 12 22C6.47715 22 2 17.5228 2 12C2 6.47715 6.47715 2 12 2C16.1006 2 19.6248 4.46819 21.1679 8", stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round" }),
  createElement("path", { d: "M17 8H21.4C21.7314 8 22 7.73137 22 7.4V3", stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round" }),
);

export const UndoIcon = icon(
  createElement("path", { d: "M4.5 8H15.5C17.9853 8 20 10.0147 20 12.5C20 14.9853 17.9853 17 15.5 17H8.5", stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round" }),
  createElement("path", { d: "M7.5 11.5L4.5 8L7.5 4.5", stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round" }),
);

export const RefreshDoubleIcon = icon(
  createElement("path", { d: "M21.1679 8C19.6247 4.46819 16.1006 2 11.9999 2C6.81459 2 2.55104 5.94668 2.04932 11", stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round" }),
  createElement("path", { d: "M17 8H21.4C21.7314 8 22 7.73137 22 7.4V3", stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round" }),
  createElement("path", { d: "M2.88146 16C4.42458 19.5318 7.94874 22 12.0494 22C17.2347 22 21.4983 18.0533 22 13", stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round" }),
  createElement("path", { d: "M7.04932 16H2.64932C2.31795 16 2.04932 16.2686 2.04932 16.6V21", stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round" }),
);

export const PlusIcon = icon(
  createElement("path", { d: "M6 12H12M18 12H12M12 12V6M12 12V18", stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round" }),
);

export const XmarkIcon = icon(
  createElement("path", { d: "M6.75827 17.2426L12.0009 12M17.2435 6.75736L12.0009 12M12.0009 12L6.75827 6.75736M12.0009 12L17.2435 17.2426", stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round" }),
);

export const CheckIcon = icon(
  createElement("path", { d: "M5 13L9 17L19 7", stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round" }),
);

export const SearchIcon = icon(
  createElement("path", { d: "M17 17L21 21", stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round" }),
  createElement("path", { d: "M3 11C3 15.4183 6.58172 19 11 19C13.213 19 15.2161 18.1015 16.6644 16.6493C18.1077 15.2022 19 13.2053 19 11C19 6.58172 15.4183 3 11 3C6.58172 3 3 6.58172 3 11Z", stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round" }),
);

export const SidebarCollapseIcon = icon(
  createElement("path", { d: "M19 21L5 21C3.89543 21 3 20.1046 3 19L3 5C3 3.89543 3.89543 3 5 3L19 3C20.1046 3 21 3.89543 21 5L21 19C21 20.1046 20.1046 21 19 21Z", stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round" }),
  createElement("path", { d: "M7.25 10L5.5 12L7.25 14", stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round" }),
  createElement("path", { d: "M9.5 21V3", stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round" }),
);

export const FolderIcon = icon(
  createElement("path", { d: "M2 11V4.6C2 4.26863 2.26863 4 2.6 4H8.77805C8.92127 4 9.05977 4.05124 9.16852 4.14445L12.3315 6.85555C12.4402 6.94876 12.5787 7 12.722 7H21.4C21.7314 7 22 7.26863 22 7.6V11M2 11V19.4C2 19.7314 2.26863 20 2.6 20H21.4C21.7314 20 22 19.7314 22 19.4V11M2 11H22", stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round" }),
);

export const GitBranchIcon = icon(
  createElement("path", { d: "M18 8C19.1046 8 20 7.10457 20 6C20 4.89543 19.1046 4 18 4C16.8954 4 16 4.89543 16 6C16 7.10457 16.8954 8 18 8Z", stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round" }),
  createElement("path", { d: "M6 20C7.10457 20 8 19.1046 8 18C8 16.8954 7.10457 16 6 16C4.89543 16 4 16.8954 4 18C4 19.1046 4.89543 20 6 20Z", stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round" }),
  createElement("path", { d: "M6 16V3", stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round" }),
  createElement("path", { d: "M8 18H9C12.5 18 18 15.9 18 9.5V8", stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round" }),
);

export const BookIcon = icon(
  createElement("path", { d: "M4 19V5C4 3.89543 4.89543 3 6 3H19.4C19.7314 3 20 3.26863 20 3.6V16.7143", stroke: "currentColor", strokeLinecap: "round" }),
  createElement("path", { d: "M6 17L20 17", stroke: "currentColor", strokeLinecap: "round" }),
  createElement("path", { d: "M6 21L20 21", stroke: "currentColor", strokeLinecap: "round" }),
  createElement("path", { d: "M6 21C4.89543 21 4 20.1046 4 19C4 17.8954 4.89543 17 6 17", stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round" }),
  createElement("path", { d: "M9 7L15 7", stroke: "currentColor", strokeLinecap: "round" }),
);

export const MoreHorizIcon = icon(
  createElement("path", { d: "M20 12.5C20.2761 12.5 20.5 12.2761 20.5 12C20.5 11.7239 20.2761 11.5 20 11.5C19.7239 11.5 19.5 11.7239 19.5 12C19.5 12.2761 19.7239 12.5 20 12.5Z", fill: "currentColor", stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round" }),
  createElement("path", { d: "M12 12.5C12.2761 12.5 12.5 12.2761 12.5 12C12.5 11.7239 12.2761 11.5 12 11.5C11.7239 11.5 11.5 11.7239 11.5 12C11.5 12.2761 11.7239 12.5 12 12.5Z", fill: "currentColor", stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round" }),
  createElement("path", { d: "M4 12.5C4.27614 12.5 4.5 12.2761 4.5 12C4.5 11.7239 4.27614 11.5 4 11.5C3.72386 11.5 3.5 11.7239 3.5 12C3.5 12.2761 3.72386 12.5 4 12.5Z", fill: "currentColor", stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round" }),
);

export const MoreVertIcon = icon(
  createElement("path", { d: "M12 12.5C12.2761 12.5 12.5 12.2761 12.5 12C12.5 11.7239 12.2761 11.5 12 11.5C11.7239 11.5 11.5 11.7239 11.5 12C11.5 12.2761 11.7239 12.5 12 12.5Z", fill: "currentColor", stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round" }),
  createElement("path", { d: "M12 20.5C12.2761 20.5 12.5 20.2761 12.5 20C12.5 19.7239 12.2761 19.5 12 19.5C11.7239 19.5 11.5 19.7239 11.5 20C11.5 20.2761 11.7239 20.5 12 20.5Z", fill: "currentColor", stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round" }),
  createElement("path", { d: "M12 4.5C12.2761 4.5 12.5 4.27614 12.5 4C12.5 3.72386 12.2761 3.5 12 3.5C11.7239 3.5 11.5 3.72386 11.5 4C11.5 4.27614 11.7239 4.5 12 4.5Z", fill: "currentColor", stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round" }),
);

export const OpenNewWindowIcon = icon(
  createElement("path", { d: "M21 3L15 3M21 3L12 12M21 3V9", stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round" }),
  createElement("path", { d: "M21 13V19C21 20.1046 20.1046 21 19 21H5C3.89543 21 3 20.1046 3 19V5C3 3.89543 3.89543 3 5 3H11", stroke: "currentColor", strokeLinecap: "round" }),
);

export const CopyIcon = icon(
  createElement("path", { d: "M19.4 20H9.6C9.26863 20 9 19.7314 9 19.4V9.6C9 9.26863 9.26863 9 9.6 9H19.4C19.7314 9 20 9.26863 20 9.6V19.4C20 19.7314 19.7314 20 19.4 20Z", stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round" }),
  createElement("path", { d: "M15 9V4.6C15 4.26863 14.7314 4 14.4 4H4.6C4.26863 4 4 4.26863 4 4.6V14.4C4 14.7314 4.26863 15 4.6 15H9", stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round" }),
);

export const ClockIcon = icon(
  createElement("path", { d: "M12 6L12 12L18 12", stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round" }),
  createElement("path", { d: "M12 22C17.5228 22 22 17.5228 22 12C22 6.47715 17.5228 2 12 2C6.47715 2 2 6.47715 2 12C2 17.5228 6.47715 22 12 22Z", stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round" }),
);

export const TrashIcon = icon(
  createElement("path", { d: "M20 9L18.005 20.3463C17.8369 21.3026 17.0062 22 16.0353 22H7.96474C6.99379 22 6.1631 21.3026 5.99496 20.3463L4 9", stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round" }),
  createElement("path", { d: "M21 6L15.375 6M3 6L8.625 6M8.625 6V4C8.625 2.89543 9.52043 2 10.625 2H13.375C14.4796 2 15.375 2.89543 15.375 4V6M8.625 6L15.375 6", stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round" }),
);

export const PageIcon = icon(
  createElement("path", { d: "M4 21.4V2.6C4 2.26863 4.26863 2 4.6 2H16.2515C16.4106 2 16.5632 2.06321 16.6757 2.17574L19.8243 5.32426C19.9368 5.43679 20 5.5894 20 5.74853V21.4C20 21.7314 19.7314 22 19.4 22H4.6C4.26863 22 4 21.7314 4 21.4Z", stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round" }),
  createElement("path", { d: "M8 10L16 10", stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round" }),
  createElement("path", { d: "M8 18L16 18", stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round" }),
  createElement("path", { d: "M8 14L12 14", stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round" }),
  createElement("path", { d: "M16 2V5.4C16 5.73137 16.2686 6 16.6 6H20", stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round" }),
);

export const TerminalIcon = icon(
  createElement("path", { d: "M13 17H20", stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round" }),
  createElement("path", { d: "M5 7L10 12L5 17", stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round" }),
);

export const PlayIcon = icon(
  createElement("path", { d: "M6.90588 4.53682C6.50592 4.2998 6 4.58808 6 5.05299V18.947C6 19.4119 6.50592 19.7002 6.90588 19.4632L18.629 12.5162C19.0211 12.2838 19.0211 11.7162 18.629 11.4838L6.90588 4.53682Z", stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round" }),
);

export const InfoCircleIcon = icon(
  createElement("path", { d: "M12 11.5V16.5", stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round" }),
  createElement("path", { d: "M12 7.51L12.01 7.49889", stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round" }),
  createElement("path", { d: "M12 22C17.5228 22 22 17.5228 22 12C22 6.47715 17.5228 2 12 2C6.47715 2 2 6.47715 2 12C2 17.5228 6.47715 22 12 22Z", stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round" }),
);

export const ChatBubbleIcon = icon(
  createElement("path", { d: "M17 12.5C17.2761 12.5 17.5 12.2761 17.5 12C17.5 11.7239 17.2761 11.5 17 11.5C16.7239 11.5 16.5 11.7239 16.5 12C16.5 12.2761 16.7239 12.5 17 12.5Z", fill: "currentColor", stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round" }),
  createElement("path", { d: "M12 12.5C12.2761 12.5 12.5 12.2761 12.5 12C12.5 11.7239 12.2761 11.5 12 11.5C11.7239 11.5 11.5 11.7239 11.5 12C11.5 12.2761 11.7239 12.5 12 12.5Z", fill: "currentColor", stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round" }),
  createElement("path", { d: "M7 12.5C7.27614 12.5 7.5 12.2761 7.5 12C7.5 11.7239 7.27614 11.5 7 11.5C6.72386 11.5 6.5 11.7239 6.5 12C6.5 12.2761 6.72386 12.5 7 12.5Z", fill: "currentColor", stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round" }),
  createElement("path", { d: "M12 22C17.5228 22 22 17.5228 22 12C22 6.47715 17.5228 2 12 2C6.47715 2 2 6.47715 2 12C2 13.8214 2.48697 15.5291 3.33782 17L2.5 21.5L7 20.6622C8.47087 21.513 10.1786 22 12 22Z", stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round" }),
);

export const SunLightIcon = icon(
  createElement("path", { d: "M12 18C15.3137 18 18 15.3137 18 12C18 8.68629 15.3137 6 12 6C8.68629 6 6 8.68629 6 12C6 15.3137 8.68629 18 12 18Z", stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round" }),
  createElement("path", { d: "M22 12L23 12", stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round" }),
  createElement("path", { d: "M12 2V1", stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round" }),
  createElement("path", { d: "M12 23V22", stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round" }),
  createElement("path", { d: "M20 20L19 19", stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round" }),
  createElement("path", { d: "M20 4L19 5", stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round" }),
  createElement("path", { d: "M4 20L5 19", stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round" }),
  createElement("path", { d: "M4 4L5 5", stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round" }),
  createElement("path", { d: "M1 12L2 12", stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round" }),
);

export const HalfMoonIcon = icon(
  createElement("path", { d: "M3 11.5066C3 16.7497 7.25034 21 12.4934 21C16.2209 21 19.4466 18.8518 21 15.7259C12.4934 15.7259 8.27411 11.5066 8.27411 3C5.14821 4.55344 3 7.77915 3 11.5066Z", stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round" }),
);

export const DownloadIcon = icon(
  createElement("path", { d: "M6 20L18 20", stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round" }),
  createElement("path", { d: "M12 4V16M12 16L15.5 12.5M12 16L8.5 12.5", stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round" }),
);

export const SettingsIcon = icon(
  createElement("path", { d: "M12 15C13.6569 15 15 13.6569 15 12C15 10.3431 13.6569 9 12 9C10.3431 9 9 10.3431 9 12C9 13.6569 10.3431 15 12 15Z", stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round" }),
  createElement("path", { d: "M19.6224 10.3954L18.5247 7.7448L20 6L18 4L16.2647 5.48295L13.5578 4.36974L12.9353 2H10.981L10.3491 4.40113L7.70441 5.51596L6 4L4 6L5.45337 7.78885L4.3725 10.4463L2 11V13L4.40111 13.6555L5.51575 16.2997L4 18L6 20L7.79116 18.5403L10.397 19.6123L11 22H13L13.6045 19.6132L16.2551 18.5155C16.6969 18.8313 18 20 18 20L20 18L18.5159 16.2494L19.6139 13.598L21.9999 12.9772L22 11L19.6224 10.3954Z", stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round" }),
);

export const MenuIcon = icon(
  createElement("path", { d: "M3 5H21", stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round" }),
  createElement("path", { d: "M3 12H21", stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round" }),
  createElement("path", { d: "M3 19H21", stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round" }),
);

export const UploadIcon = icon(
  createElement("path", { d: "M6 20L18 20", stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round" }),
  createElement("path", { d: "M12 16V4M12 4L15.5 7.5M12 4L8.5 7.5", stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round" }),
);

export const EditPencilIcon = icon(
  createElement("path", { d: "M14.3632 5.65156L15.8431 4.17157C16.6242 3.39052 17.8905 3.39052 18.6716 4.17157L20.0858 5.58579C20.8668 6.36683 20.8668 7.63316 20.0858 8.41421L18.6058 9.8942M14.3632 5.65156L4.74749 15.2672C4.41542 15.5993 4.21079 16.0376 4.16947 16.5054L3.92738 19.2459C3.87261 19.8659 4.39148 20.3848 5.0115 20.33L7.75191 20.0879C8.21972 20.0466 8.65806 19.8419 8.99013 19.5099L18.6058 9.8942M14.3632 5.65156L18.6058 9.8942", stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round" }),
);

export const AttachmentIcon = icon(
  createElement("path", { d: "M21.4383 11.6622L12.2483 20.8522C11.1225 21.9781 9.59552 22.6106 8.00334 22.6106C6.41115 22.6106 4.88418 21.9781 3.75834 20.8522C2.63249 19.7264 2 18.1994 2 16.6072C2 15.015 2.63249 13.4881 3.75834 12.3622L12.9483 3.17222C13.6989 2.42166 14.7169 2 15.7783 2C16.8398 2 17.8578 2.42166 18.6083 3.17222C19.3589 3.92279 19.7806 4.94077 19.7806 6.00222C19.7806 7.06368 19.3589 8.08166 18.6083 8.83222L9.40834 18.0222C9.03306 18.3975 8.52406 18.6083 7.99334 18.6083C7.46261 18.6083 6.95362 18.3975 6.57834 18.0222C6.20306 17.6469 5.99222 17.138 5.99222 16.6072C5.99222 16.0765 6.20306 15.5675 6.57834 15.1922L15.0683 6.71222", stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round" }),
);

export const LockIcon = icon(
  createElement("path", { d: "M16 12H17.4C17.7314 12 18 12.2686 18 12.6V19.4C18 19.7314 17.7314 20 17.4 20H6.6C6.26863 20 6 19.7314 6 19.4V12.6C6 12.2686 6.26863 12 6.6 12H8M16 12V8C16 6.66667 15.2 4 12 4C8.8 4 8 6.66667 8 8V12M16 12H8", stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round" }),
);

export const LockSlashIcon = icon(
  createElement("path", { d: "M11.5 12H6.6C6.26863 12 6 12.2686 6 12.6V19.4C6 19.7314 6.26863 20 6.6 20H17.4C17.7314 20 18 19.7314 18 19.4V18.5", stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round" }),
  createElement("path", { d: "M16 12V8C16 6.66667 15.2 4 12 4C11.2532 4 10.6371 4.14525 10.1313 4.38491", stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round" }),
  createElement("path", { d: "M16 12H17.4C17.7314 12 18 12.2686 18 12.6V13", stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round" }),
  createElement("path", { d: "M8 8V8.5V12", stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round" }),
  createElement("path", { d: "M3 3L21 21", stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round" }),
);

export const ArchiveIcon = icon(
  createElement("path", { d: "M7 6L17 6", stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round" }),
  createElement("path", { d: "M7 9L17 9", stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round" }),
  createElement("path", { d: "M9 17H15", stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round" }),
  createElement("path", { d: "M3 12H2.6C2.26863 12 2 12.2686 2 12.6V21.4C2 21.7314 2.26863 22 2.6 22H21.4C21.7314 22 22 21.7314 22 21.4V12.6C22 12.2686 21.7314 12 21.4 12H21M3 12V2.6C3 2.26863 3.26863 2 3.6 2H20.4C20.7314 2 21 2.26863 21 2.6V12M3 12H21", stroke: "currentColor", strokeWidth: "1.5" }),
);

export const EyeIcon = icon(
  createElement("path", { d: "M3 13C6.6 5 17.4 5 21 13", stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round" }),
  createElement("path", { d: "M12 17C10.3431 17 9 15.6569 9 14C9 12.3431 10.3431 11 12 11C13.6569 11 15 12.3431 15 14C15 15.6569 13.6569 17 12 17Z", stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round" }),
);

export const UserIcon = icon(
  createElement("path", { d: "M5 20V19C5 15.134 8.13401 12 12 12V12C15.866 12 19 15.134 19 19V20", stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round" }),
  createElement("path", { d: "M12 12C14.2091 12 16 10.2091 16 8C16 5.79086 14.2091 4 12 4C9.79086 4 8 5.79086 8 8C8 10.2091 9.79086 12 12 12Z", stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round" }),
);

export const UserCircleIcon = icon(
  createElement("path", { d: "M7 18V17C7 14.2386 9.23858 12 12 12V12C14.7614 12 17 14.2386 17 17V18", stroke: "currentColor", strokeLinecap: "round" }),
  createElement("path", { d: "M12 12C13.6569 12 15 10.6569 15 9C15 7.34315 13.6569 6 12 6C10.3431 6 9 7.34315 9 9C9 10.6569 10.3431 12 12 12Z", stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round" }),
  createElement("circle", { cx: "12", cy: "12", r: "10", stroke: "currentColor", strokeWidth: "1.5" }),
);

export const DatabaseIcon = icon(
  createElement("path", { d: "M5 12V18C5 18 5 21 12 21C19 21 19 18 19 18V12", stroke: "currentColor", strokeWidth: "1.5" }),
  createElement("path", { d: "M5 6V12C5 12 5 15 12 15C19 15 19 12 19 12V6", stroke: "currentColor", strokeWidth: "1.5" }),
  createElement("path", { d: "M12 3C19 3 19 6 19 6C19 6 19 9 12 9C5 9 5 6 5 6C5 6 5 3 12 3Z", stroke: "currentColor", strokeWidth: "1.5" }),
);

export const NetworkIcon = icon(
  createElement("rect", { x: "3", y: "2", width: "7", height: "5", rx: "0.6", stroke: "currentColor", strokeWidth: "1.5" }),
  createElement("rect", { x: "8.5", y: "17", width: "7", height: "5", rx: "0.6", stroke: "currentColor", strokeWidth: "1.5" }),
  createElement("rect", { x: "14", y: "2", width: "7", height: "5", rx: "0.6", stroke: "currentColor", strokeWidth: "1.5" }),
  createElement("path", { d: "M6.5 7V10.5C6.5 11.6046 7.39543 12.5 8.5 12.5H15.5C16.6046 12.5 17.5 11.6046 17.5 10.5V7", stroke: "currentColor", strokeWidth: "1.5" }),
  createElement("path", { d: "M12 12.5V17", stroke: "currentColor", strokeWidth: "1.5" }),
);

export const ShieldAlertIcon = icon(
  createElement("path", { d: "M12 7L12 12", stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round" }),
  createElement("path", { d: "M12 16.01L12.01 15.9989", stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round" }),
  createElement("path", { d: "M5 18L3.13036 4.91253C3.05646 4.39524 3.39389 3.91247 3.90398 3.79912L11.5661 2.09641C11.8519 2.03291 12.1481 2.03291 12.4339 2.09641L20.096 3.79912C20.6061 3.91247 20.9435 4.39524 20.8696 4.91252L19 18C18.9293 18.495 18.5 21.5 12 21.5C5.5 21.5 5.07071 18.495 5 18Z", stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round" }),
);

export const CodeIcon = icon(
  createElement("path", { d: "M13.5 6L10 18.5", stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round" }),
  createElement("path", { d: "M6.5 8.5L3 12L6.5 15.5", stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round" }),
  createElement("path", { d: "M17.5 8.5L21 12L17.5 15.5", stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round" }),
);

export const BugIcon = icon(
  createElement("path", { d: "M12 21C8.13401 21 5 16.9706 5 12C5 7.02944 8.13401 3 12 3C15.866 3 19 7.02944 19 12C19 16.9706 15.866 21 12 21Z", stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round" }),
  createElement("path", { d: "M18 17.5L20 19.5", stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round" }),
  createElement("path", { d: "M19 9.5L21 8.5", stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round" }),
  createElement("path", { d: "M5 9.5L3 8.5", stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round" }),
  createElement("path", { d: "M18 8C18 8 15 9 12 9M6 8C6 8 9 9 12 9M12 9V21", stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round" }),
  createElement("path", { d: "M5 14H2", stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round" }),
  createElement("path", { d: "M22 14H19", stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round" }),
  createElement("path", { d: "M6 17.5L4 19.5", stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round" }),
);
