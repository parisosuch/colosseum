import { Column } from "./column";
import { ColumnScreenshot } from "./screenshot-data";

// One block as it appears in an export. Mirrors the per-block fields a viewer
// can already see on the channel page, plus the cached screenshot URL for
// `url` blocks. Internal columns (id, created_by, channel_id) are intentionally
// omitted — an export is for backup/migration, not a raw table dump.
export type ExportedBlock = {
  type: Column["type"];
  title: string | null;
  description: string | null;
  url: string | null;
  text: string | null;
  image: string | null;
  // Cached website screenshot for `url` blocks; null for other types or when no
  // screenshot has been captured yet.
  image_url: string | null;
  created_at: string;
};

export type ChannelExport = {
  exported_at: string;
  channel: {
    title: string;
    description: string | null;
  };
  blocks: ExportedBlock[];
};

// The ordered field list, shared by the JSON shape and the CSV columns so the
// two formats can never drift.
const BLOCK_FIELDS: (keyof ExportedBlock)[] = [
  "type",
  "title",
  "description",
  "url",
  "text",
  "image",
  "image_url",
  "created_at",
];

export function buildChannelExport(
  channel: { title: string; description?: string | null },
  columns: Column[],
  screenshots: Map<string, ColumnScreenshot>,
): ChannelExport {
  return {
    exported_at: new Date().toISOString(),
    channel: {
      title: channel.title,
      description: channel.description ?? null,
    },
    blocks: columns.map((column) => ({
      type: column.type,
      title: column.title ?? null,
      description: column.description ?? null,
      url: column.url ?? null,
      text: column.text ?? null,
      image: column.image ?? null,
      image_url: column.url ? (screenshots.get(column.url)?.image_url ?? null) : null,
      created_at: column.created_at,
    })),
  };
}

export function toJSON(data: ChannelExport): string {
  return JSON.stringify(data, null, 2);
}

// RFC 4180 cell: wrap in quotes (escaping embedded quotes) only when the value
// contains a comma, quote, or newline.
function csvCell(value: string | null): string {
  const s = value ?? "";
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCSV(data: ChannelExport): string {
  const header = BLOCK_FIELDS.join(",");
  const rows = data.blocks.map((block) =>
    BLOCK_FIELDS.map((field) => csvCell(block[field])).join(","),
  );
  return [header, ...rows].join("\r\n");
}

// Filesystem-safe base name from the channel title, e.g. "Design Inspiration"
// -> "design-inspiration". Falls back to "channel" when the title has no usable
// characters.
export function exportFilename(title: string, extension: "json" | "csv"): string {
  const slug =
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "channel";
  const date = new Date().toISOString().slice(0, 10);
  return `${slug}-${date}.${extension}`;
}
