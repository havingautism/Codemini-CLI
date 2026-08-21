import { createElement, forwardRef } from "react";
import {
  IconAdjustmentsHorizontal,
  IconAlertCircle,
  IconAlertCircleFilled,
  IconAlertTriangle,
  IconAlertTriangleFilled,
  IconArchive,
  IconArrowBackUp,
  IconArrowDown,
  IconArrowLeft,
  IconArrowRampRight2,
  IconArrowRight,
  IconArrowsMaximize,
  IconArrowUp,
  IconArticle,
  IconArticleFilled,
  IconBolt,
  IconBoltFilled,
  IconBook,
  IconBookFilled,
  IconBook2,
  IconBrain,
  IconBrandWindows,
  IconBrandWindowsFilled,
  IconBug,
  IconBulb,
  IconBulbFilled,
  IconCamera,
  IconCameraFilled,
  IconChartLine,
  IconCheck,
  IconCheckFilled,
  IconChevronDown,
  IconChevronLeft,
  IconChevronRight,
  IconChevronRightFilled,
  IconChevronUp,
  IconCircle,
  IconCircleCheck,
  IconCircleCheckFilled,
  IconCircleFilled,
  IconCircleX,
  IconCircleXFilled,
  IconCircuitCell,
  IconCode,
  IconCoffee,
  IconCommand,
  IconCompass,
  IconCopy,
  IconDatabase,
  IconDatabaseFilled,
  IconDeviceDesktop,
  IconDeviceFloppy,
  IconDeviceFloppyFilled,
  IconDots,
  IconDotsVertical,
  IconDownload,
  IconDownloadFilled,
  IconExternalLink,
  IconExternalLinkFilled,
  IconEye,
  IconFileDiff,
  IconFileDiffFilled,
  IconFileText,
  IconFileTextFilled,
  IconFlask,
  IconFlaskFilled,
  IconFolder,
  IconFolderFilled,
  IconFolderOpen,
  IconFolderOpenFilled,
  IconGitBranch,
  IconGripVertical,
  IconHammer,
  IconHandStop,
  IconHelpCircle,
  IconHelpCircleFilled,
  IconHierarchy2,
  IconHourglass,
  IconHourglassFilled,
  IconInbox,
  IconInfoCircle,
  IconInfoCircleFilled,
  IconLayoutGrid,
  IconLayoutGridFilled,
  IconLayoutSidebar,
  IconLayoutSidebarFilled,
  IconLink,
  IconLinkFilled,
  IconList,
  IconListCheck,
  IconLoader2,
  IconLock,
  IconLockFilled,
  IconLockOpen,
  IconMenu2,
  IconMessage,
  IconMessageCircle,
  IconMessageCircleFilled,
  IconMinus,
  IconMoodHappy,
  IconMoodHappyFilled,
  IconMoon,
  IconMoonFilled,
  IconNetwork,
  IconNotebook,
  IconPackage,
  IconPaperclip,
  IconPencil,
  IconPencilFilled,
  IconPhoto,
  IconPhotoFilled,
  IconPlayerPlay,
  IconPlayerPlayFilled,
  IconPlayerStop,
  IconPlayerStopFilled,
  IconPlug,
  IconPlugConnected,
  IconPlus,
  IconPlusFilled,
  IconRecycle,
  IconRefresh,
  IconSearch,
  IconSearchFilled,
  IconServer,
  IconSettings,
  IconSettingsFilled,
  IconShieldExclamation,
  IconSparkle,
  IconSparklesFilled,
  IconStar,
  IconStarFilled,
  IconSun,
  IconSunFilled,
  IconTarget,
  IconTerminal2,
  IconTool,
  IconTrash,
  IconTrashFilled,
  IconUpload,
  IconUser,
  IconUserCircle,
  IconUserFilled,
  IconWorld,
  IconWorldFilled,
  IconX,
  IconXFilled,
} from "@tabler/icons-react";

function strokeForWeight(weight) {
  if (weight === "bold") return 2.3;
  if (weight === "light") return 1.35;
  if (weight === "thin") return 1.15;
  return 1.7;
}

function wrap(Outline, Filled) {
  const Icon = forwardRef(function Icon(
    { weight = "regular", size, color, className, ...props },
    ref,
  ) {
    const Comp =
      (weight === "fill" || weight === "duotone") && Filled
        ? Filled
        : Outline;
    return createElement(Comp, {
      ref,
      size,
      color,
      stroke: strokeForWeight(weight),
      className,
      ...props,
    });
  });
  Icon.displayName = Outline.displayName || Outline.name || "Icon";
  return Icon;
}

export const Archive = wrap(IconArchive);
export const ArrowClockwise = wrap(IconRefresh);
export const ArrowCounterClockwise = wrap(IconArrowBackUp);
export const ArrowDown = wrap(IconArrowDown);
export const ArrowLeft = wrap(IconArrowLeft);
export const ArrowRight = wrap(IconArrowRight);
export const ArrowSquareOut = wrap(IconExternalLink, IconExternalLinkFilled);
export const ArrowUp = wrap(IconArrowUp);
export const ArrowsClockwise = wrap(IconRefresh);
export const ArrowsOutSimple = wrap(IconArrowsMaximize);
export const Camera = wrap(IconCamera, IconCameraFilled);
export const Article = wrap(IconArticle, IconArticleFilled);
export const BookOpen = wrap(IconBook, IconBookFilled);
export const BookOpenText = wrap(IconBook2);
export const Brain = wrap(IconBrain);
export const Bug = wrap(IconBug);
export const CaretDown = wrap(IconChevronDown);
export const CaretLeft = wrap(IconChevronLeft);
export const CaretRight = wrap(IconChevronRight, IconChevronRightFilled);
export const CaretUp = wrap(IconChevronUp);
export const ChartLine = wrap(IconChartLine);
export const ChatCircle = wrap(IconMessageCircle, IconMessageCircleFilled);
export const ChatText = wrap(IconMessage);
export const Check = wrap(IconCheck, IconCheckFilled);
export const CheckCircle = wrap(IconCircleCheck, IconCircleCheckFilled);
export const Circle = wrap(IconCircle, IconCircleFilled);
export const CircleNotch = wrap(IconLoader2);
export const Circuitry = wrap(IconCircuitCell);
export const Code = wrap(IconCode);
export const Coffee = wrap(IconCoffee);
export const Command = wrap(IconCommand);
export const Compass = wrap(IconCompass);
export const Copy = wrap(IconCopy);
export const CopySimple = wrap(IconCopy);
export const Database = wrap(IconDatabase, IconDatabaseFilled);
export const DotsSixVertical = wrap(IconGripVertical);
export const DotsThree = wrap(IconDots);
export const DotsThreeVertical = wrap(IconDotsVertical);
export const Download = wrap(IconDownload, IconDownloadFilled);
export const Eye = wrap(IconEye);
export const FileText = wrap(IconFileText, IconFileTextFilled);
export const Flask = wrap(IconFlask, IconFlaskFilled);
export const FloppyDisk = wrap(IconDeviceFloppy, IconDeviceFloppyFilled);
export const FlowArrow = wrap(IconArrowRampRight2);
export const Folder = wrap(IconFolder, IconFolderFilled);
export const FolderOpen = wrap(IconFolderOpen, IconFolderOpenFilled);
export const FolderSimple = wrap(IconFolder, IconFolderFilled);
export const GearSix = wrap(IconSettings, IconSettingsFilled);
export const GitBranch = wrap(IconGitBranch);
export const GitDiff = wrap(IconFileDiff, IconFileDiffFilled);
export const Globe = wrap(IconWorld, IconWorldFilled);
export const GridFour = wrap(IconLayoutGrid, IconLayoutGridFilled);
export const Hammer = wrap(IconHammer);
export const HandPalm = wrap(IconHandStop);
export const HardDrives = wrap(IconServer);
export const Hourglass = wrap(IconHourglass, IconHourglassFilled);
export const ImageSquare = wrap(IconPhoto, IconPhotoFilled);
export const Info = wrap(IconInfoCircle, IconInfoCircleFilled);
export const Lightbulb = wrap(IconBulb, IconBulbFilled);
export const Lightning = wrap(IconBolt, IconBoltFilled);
export const LinkSimple = wrap(IconLink, IconLinkFilled);
export const List = wrap(IconMenu2);
export const ListBullets = wrap(IconList);
export const ListChecks = wrap(IconListCheck);
export const Lock = wrap(IconLock, IconLockFilled);
export const LockOpen = wrap(IconLockOpen);
export const MagnifyingGlass = wrap(IconSearch, IconSearchFilled);
export const MaskHappy = wrap(IconMoodHappy, IconMoodHappyFilled);
export const Minus = wrap(IconMinus);
export const Monitor = wrap(IconDeviceDesktop);
export const Moon = wrap(IconMoon, IconMoonFilled);
export const Network = wrap(IconNetwork);
export const Notebook = wrap(IconNotebook);
export const Package = wrap(IconPackage);
export const Paperclip = wrap(IconPaperclip);
export const PencilLine = wrap(IconPencil, IconPencilFilled);
export const PencilSimple = wrap(IconPencil, IconPencilFilled);
export const Play = wrap(IconPlayerPlay, IconPlayerPlayFilled);
export const Plug = wrap(IconPlug);
export const PlugsConnected = wrap(IconPlugConnected);
export const Plus = wrap(IconPlus, IconPlusFilled);
export const Question = wrap(IconHelpCircle, IconHelpCircleFilled);
export const Recycle = wrap(IconRecycle);
export const ShieldWarning = wrap(IconShieldExclamation);
export const SidebarSimple = wrap(IconLayoutSidebar, IconLayoutSidebarFilled);
export const SlidersHorizontal = wrap(IconAdjustmentsHorizontal);
export const Sparkle = wrap(IconSparkle, IconSparklesFilled);
export const Star = wrap(IconStar, IconStarFilled);
export const Stop = wrap(IconPlayerStop, IconPlayerStopFilled);
export const Sun = wrap(IconSun, IconSunFilled);
export const Target = wrap(IconTarget);
export const Terminal = wrap(IconTerminal2);
export const TerminalWindow = wrap(IconTerminal2);
export const Trash = wrap(IconTrash, IconTrashFilled);
export const Tray = wrap(IconInbox);
export const TreeStructure = wrap(IconHierarchy2);
export const UploadSimple = wrap(IconUpload);
export const User = wrap(IconUser, IconUserFilled);
export const UserCircle = wrap(IconUserCircle);
export const Warning = wrap(IconAlertTriangle, IconAlertTriangleFilled);
export const WarningCircle = wrap(IconAlertCircle, IconAlertCircleFilled);
export const WindowsLogo = wrap(IconBrandWindows, IconBrandWindowsFilled);
export const Wrench = wrap(IconTool);
export const X = wrap(IconX, IconXFilled);
export const XCircle = wrap(IconCircleX, IconCircleXFilled);
