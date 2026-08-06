export type Category =
  | "music"
  | "video"
  | "compressed"
  | "programs"
  | "apk"
  | "ipa"
  | "images"
  | "documents"
  | "other";

export const CATEGORY_LABELS: Record<Category, string> = {
  music: "Music",
  video: "Videos",
  compressed: "Compressed",
  programs: "Programs",
  apk: "APKs",
  ipa: "IPAs",
  images: "Images",
  documents: "Documents",
  other: "Other",
};

export const CATEGORY_ORDER: Category[] = [
  "music",
  "video",
  "compressed",
  "programs",
  "apk",
  "ipa",
  "images",
  "documents",
  "other",
];

export const CATEGORY_PREFIX = "cat:";

const EXTENSION_SETS: Record<Exclude<Category, "other">, string[]> = {
  music: ["mp3", "wav", "flac", "aac", "ogg", "m4a", "wma", "opus"],
  video: ["mp4", "mkv", "avi", "mov", "wmv", "webm", "flv", "m4v"],
  compressed: ["zip", "rar", "7z", "tar", "gz", "bz2", "xz", "iso", "tgz"],
  programs: ["exe", "msi", "dmg", "pkg", "deb", "rpm", "appimage"],
  apk: ["apk", "apks", "xapk"],
  ipa: ["ipa"],
  images: ["jpg", "jpeg", "png", "gif", "webp", "bmp", "svg", "ico", "heic", "avif"],
  documents: ["pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "txt", "epub", "md"],
};

function normalizeExtension(ext: string): string {
  return ext.trim().toLowerCase().replace(/^\.+/, "");
}

export function categoryFor(ext: string): Category {
  const normalized = normalizeExtension(ext);
  if (!normalized) return "other";
  const parts = normalized.split(".");
  const candidates = [parts[parts.length - 1], ...parts.slice(0, -1).reverse()];
  for (const part of candidates) {
    for (const category of CATEGORY_ORDER) {
      if (category === "other") continue;
      if (EXTENSION_SETS[category].includes(part)) return category;
    }
  }
  return "other";
}
