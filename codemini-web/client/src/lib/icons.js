import { createElement, forwardRef } from "react";
import {
  IconAlarm,
  IconAdjustmentsHorizontal,
  IconAlertCircle,
  IconAlertCircleFilled,
  IconAlertTriangle,
  IconAlertTriangleFilled,
  IconArrowRampRight2,
  IconArrowsMaximize,
  IconArticle,
  IconArticleFilled,
  IconBolt,
  IconBoltFilled,
  IconBook,
  IconBookFilled,
  IconBook2,
  IconBrain,
  IconBrandGit,
  IconBrandWindows,
  IconBrandWindowsFilled,
  IconBulb,
  IconBulbFilled,
  IconCamera,
  IconCameraFilled,
  IconChartLine,
  IconCheckFilled,
  IconChevronRightFilled,
  IconCircle,
  IconCircleCheck,
  IconCircleCheckFilled,
  IconCircleFilled,
  IconCircleX,
  IconCircleXFilled,
  IconCircuitCell,
  IconCoffee,
  IconCommand,
  IconCompass,
  IconDatabaseFilled,
  IconDeviceDesktop,
  IconDeviceFloppy,
  IconDeviceFloppyFilled,
  IconDownloadFilled,
  IconExternalLinkFilled,
  IconFileDiff,
  IconFileDiffFilled,
  IconFileTextFilled,
  IconFlask,
  IconFlaskFilled,
  IconFolderFilled,
  IconFolderOpen,
  IconFolderOpenFilled,
  IconGripVertical,
  IconHammer,
  IconHandStop,
  IconHelpCircle,
  IconHelpCircleFilled,
  IconHierarchy2,
  IconHourglass,
  IconHourglassFilled,
  IconInbox,
  IconInfoCircleFilled,
  IconLayoutGrid,
  IconLayoutGridFilled,
  IconLayoutSidebarFilled,
  IconLinkFilled,
  IconList,
  IconListCheck,
  IconLoader2,
  IconLockFilled,
  IconMessage,
  IconMessageCircleFilled,
  IconMinus,
  IconMoodHappy,
  IconMoodHappyFilled,
  IconMoonFilled,
  IconPackage,
  IconPencilFilled,
  IconPhoto,
  IconPhotoFilled,
  IconPlayerPlayFilled,
  IconPlayerStop,
  IconPlayerStopFilled,
  IconPlug,
  IconPlugConnected,
  IconPlusFilled,
  IconRecycle,
  IconSearchFilled,
  IconServer,
  IconSettingsFilled,
  IconSparkle,
  IconSparklesFilled,
  IconStar,
  IconStarFilled,
  IconSunFilled,
  IconTarget,
  IconTool,
  IconTrashFilled,
  IconUserFilled,
  IconWorldFilled,
  IconXFilled,
} from "@tabler/icons-react";
import {
  LinkIcon,
  GlobeIcon,
  NavArrowDownIcon,
  NavArrowLeftIcon,
  NavArrowRightIcon,
  NavArrowUpIcon,
  ArrowDownIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  ArrowUpIcon,
  RefreshIcon,
  RefreshDoubleIcon,
  PlusIcon,
  XmarkIcon,
  CheckIcon,
  SearchIcon,
  SidebarCollapseIcon,
  FolderIcon,
  GitBranchIcon,
  BookIcon,
  MoreHorizIcon,
  MoreVertIcon,
  OpenNewWindowIcon,
  CopyIcon,
  ClockIcon,
  TrashIcon,
  PageIcon,
  TerminalIcon,
  PlayIcon,
  InfoCircleIcon,
  ChatBubbleIcon,
  SunLightIcon,
  HalfMoonIcon,
  DownloadIcon,
  SettingsIcon,
  MenuIcon,
  UploadIcon,
  EditPencilIcon,
  AttachmentIcon,
  LockIcon,
  LockSlashIcon,
  ArchiveIcon,
  EyeIcon,
  UserIcon,
  UserCircleIcon,
  DatabaseIcon,
  NetworkIcon,
  ShieldAlertIcon,
  CodeIcon,
  BugIcon,
} from "./iconoir/glyphs.jsx";

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

export const Archive = wrap(ArchiveIcon);
export const ArrowClockwise = wrap(RefreshIcon);
export const Clock = wrap(ClockIcon);
export const ArrowCounterClockwise = wrap(RefreshDoubleIcon);
export const ArrowDown = wrap(ArrowDownIcon);
export const ArrowLeft = wrap(ArrowLeftIcon);
export const ArrowRight = wrap(ArrowRightIcon);
export const ArrowSquareOut = wrap(OpenNewWindowIcon, IconExternalLinkFilled);
export const ArrowUp = wrap(ArrowUpIcon);
export const ArrowsClockwise = wrap(RefreshIcon);
export const ArrowsOutSimple = wrap(IconArrowsMaximize);
export const Camera = wrap(IconCamera, IconCameraFilled);
export const Article = wrap(IconArticle, IconArticleFilled);
export const BookOpen = wrap(IconBook, IconBookFilled);
export const BookOpenText = wrap(IconBook2);
export const Brain = wrap(IconBrain);
export const Bug = wrap(BugIcon);
export const CaretDown = wrap(NavArrowDownIcon);
export const CaretLeft = wrap(NavArrowLeftIcon);
export const CaretRight = wrap(NavArrowRightIcon, IconChevronRightFilled);
export const CaretUp = wrap(NavArrowUpIcon);
export const ChartLine = wrap(IconChartLine);
export const ChatCircle = wrap(ChatBubbleIcon, IconMessageCircleFilled);
export const ChatText = wrap(IconMessage);
export const Check = wrap(CheckIcon, IconCheckFilled);
export const CheckCircle = wrap(IconCircleCheck, IconCircleCheckFilled);
export const Circle = wrap(IconCircle, IconCircleFilled);
export const CircleNotch = wrap(IconLoader2);
export const Circuitry = wrap(IconCircuitCell);
export const Code = wrap(CodeIcon);
export const Coffee = wrap(IconCoffee);
export const Command = wrap(IconCommand);
export const Compass = wrap(IconCompass);
export const Copy = wrap(CopyIcon);
export const CopySimple = wrap(CopyIcon);
export const Database = wrap(DatabaseIcon, IconDatabaseFilled);
export const DotsSixVertical = wrap(IconGripVertical);
export const DotsThree = wrap(MoreHorizIcon);
export const DotsThreeVertical = wrap(MoreVertIcon);
export const Download = wrap(DownloadIcon, IconDownloadFilled);
export const Eye = wrap(EyeIcon);
export const FileText = wrap(PageIcon, IconFileTextFilled);
export const Flask = wrap(IconFlask, IconFlaskFilled);
export const FloppyDisk = wrap(IconDeviceFloppy, IconDeviceFloppyFilled);
export const FlowArrow = wrap(IconArrowRampRight2);
export const Folder = wrap(FolderIcon, IconFolderFilled);
export const FolderOpen = wrap(IconFolderOpen, IconFolderOpenFilled);
export const FolderSimple = wrap(FolderIcon, IconFolderFilled);
export const GearSix = wrap(SettingsIcon, IconSettingsFilled);
export const GitLogo = wrap(IconBrandGit);
export const GitBranch = wrap(GitBranchIcon);
export const GitDiff = wrap(IconFileDiff, IconFileDiffFilled);
export const Globe = wrap(GlobeIcon, IconWorldFilled);
export const GridFour = wrap(IconLayoutGrid, IconLayoutGridFilled);
export const Hammer = wrap(IconHammer);
export const HandPalm = wrap(IconHandStop);
export const HardDrives = wrap(IconServer);
export const Hourglass = wrap(IconHourglass, IconHourglassFilled);
export const ImageSquare = wrap(IconPhoto, IconPhotoFilled);
export const Info = wrap(InfoCircleIcon, IconInfoCircleFilled);
export const Lightbulb = wrap(IconBulb, IconBulbFilled);
export const Lightning = wrap(IconBolt, IconBoltFilled);
export const LinkSimple = wrap(LinkIcon, IconLinkFilled);
export const List = wrap(MenuIcon);
export const ListBullets = wrap(IconList);
export const ListChecks = wrap(IconListCheck);
export const Lock = wrap(LockIcon, IconLockFilled);
export const LockOpen = wrap(LockSlashIcon);
export const MagnifyingGlass = wrap(SearchIcon, IconSearchFilled);
export const MaskHappy = wrap(IconMoodHappy, IconMoodHappyFilled);
export const Minus = wrap(IconMinus);
export const Monitor = wrap(IconDeviceDesktop);
export const Moon = wrap(HalfMoonIcon, IconMoonFilled);
export const Network = wrap(NetworkIcon);
export const Notebook = wrap(BookIcon);
export const Package = wrap(IconPackage);
export const Paperclip = wrap(AttachmentIcon);
export const PencilLine = wrap(EditPencilIcon, IconPencilFilled);
export const PencilSimple = wrap(EditPencilIcon, IconPencilFilled);
export const Play = wrap(PlayIcon, IconPlayerPlayFilled);
export const Plug = wrap(IconPlug);
export const PlugsConnected = wrap(IconPlugConnected);
export const Plus = wrap(PlusIcon, IconPlusFilled);
export const Question = wrap(IconHelpCircle, IconHelpCircleFilled);
export const Recycle = wrap(IconRecycle);
export const ShieldWarning = wrap(ShieldAlertIcon);
export const SidebarSimple = wrap(SidebarCollapseIcon, IconLayoutSidebarFilled);
export const SlidersHorizontal = wrap(IconAdjustmentsHorizontal);
export const Sparkle = wrap(IconSparkle, IconSparklesFilled);
export const Star = wrap(IconStar, IconStarFilled);
export const Stop = wrap(IconPlayerStop, IconPlayerStopFilled);
export const Sun = wrap(SunLightIcon, IconSunFilled);
export const Target = wrap(IconTarget);
export const Terminal = wrap(TerminalIcon);
export const TerminalWindow = wrap(TerminalIcon);
export const Trash = wrap(TrashIcon, IconTrashFilled);
export const Tray = wrap(IconInbox);
export const TreeStructure = wrap(IconHierarchy2);
export const UploadSimple = wrap(UploadIcon);
export const User = wrap(UserIcon, IconUserFilled);
export const UserCircle = wrap(UserCircleIcon);
export const Warning = wrap(IconAlertTriangle, IconAlertTriangleFilled);
export const WarningCircle = wrap(IconAlertCircle, IconAlertCircleFilled);
export const WindowsLogo = wrap(IconBrandWindows, IconBrandWindowsFilled);
export const Wrench = wrap(IconTool);
export const X = wrap(XmarkIcon, IconXFilled);
export const XCircle = wrap(IconCircleX, IconCircleXFilled);
export const Alarm = wrap(IconAlarm);
