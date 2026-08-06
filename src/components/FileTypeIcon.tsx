import {
  FileArchive,
  FileAudio,
  FileBox,
  FileCog,
  FileImage,
  FileText,
  FileVideo,
  File as FileIcon,
} from "lucide-react";
import { categoryFor, type Category } from "../categories";

const ICONS: Record<Category, typeof FileIcon> = {
  music: FileAudio,
  video: FileVideo,
  compressed: FileArchive,
  programs: FileCog,
  apk: FileBox,
  ipa: FileBox,
  images: FileImage,
  documents: FileText,
  other: FileIcon,
};

const CATEGORY_COLOR: Record<Category, string> = {
  music: "text-fuchsia-500",
  video: "text-purple-500",
  compressed: "text-amber-500",
  programs: "text-sky-500",
  apk: "text-emerald-500",
  ipa: "text-cyan-500",
  images: "text-pink-500",
  documents: "text-indigo-500",
  other: "text-zinc-400",
};

export function FileTypeIcon({ extension, className }: { extension: string; className?: string }) {
  const category = categoryFor(extension);
  const Icon = ICONS[category];
  return <Icon className={[className, CATEGORY_COLOR[category]].filter(Boolean).join(" ")} />;
}
