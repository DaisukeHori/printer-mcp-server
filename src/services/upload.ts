import { randomBytes } from "node:crypto";
import { mkdir, unlink, stat, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

// /tmp 配下は OS やコンテナの一時ファイル掃除で消えるため、
// 永続化したい場合は UPLOAD_DIR 環境変数で別パスを指定する
const UPLOAD_DIR = process.env.UPLOAD_DIR || "/tmp/printer-mcp-uploads";
const MAX_AGE_MS = 30 * 60 * 1000; // 30 minutes

export interface UploadedFile {
  file_id: string;
  filename: string;
  size: number;
  path: string;
  uploaded_at: number;
}

// In-memory registry (survives within process lifetime)
const registry = new Map<string, UploadedFile>();

export async function ensureUploadDir(): Promise<void> {
  await mkdir(UPLOAD_DIR, { recursive: true });
}

export function generateFileId(): string {
  return randomBytes(12).toString("hex"); // 24-char hex
}

export function getUploadDir(): string {
  return UPLOAD_DIR;
}

export function registerFile(fileId: string, originalName: string, savedPath: string, size: number): UploadedFile {
  const entry: UploadedFile = {
    file_id: fileId,
    filename: originalName,
    size,
    path: savedPath,
    uploaded_at: Date.now(),
  };
  registry.set(fileId, entry);
  return entry;
}

export function getFile(fileId: string): UploadedFile | undefined {
  return registry.get(fileId);
}

export async function readFileAsBase64(fileId: string): Promise<{ base64: string; filename: string } | null> {
  const entry = registry.get(fileId);
  if (!entry) return null;

  try {
    const buf = await readFile(entry.path);
    return { base64: buf.toString("base64"), filename: entry.filename };
  } catch {
    // File was deleted or missing
    registry.delete(fileId);
    return null;
  }
}

export async function deleteFile(fileId: string): Promise<void> {
  const entry = registry.get(fileId);
  if (entry) {
    try { await unlink(entry.path); } catch { /* ignore */ }
    registry.delete(fileId);
  }
}

export function listFiles(): UploadedFile[] {
  return Array.from(registry.values());
}

/**
 * Clean up files older than MAX_AGE_MS
 *
 * registry は in-memory の Map なので、プロセス再起動で中身が失われる。
 * registry だけを走査していると、再起動をまたいだファイルは削除対象から外れ、
 * 孤児として残り続ける。UPLOAD_DIR が /tmp のうちは systemd-tmpfiles の
 * 30 日クリーンアップが最後の防波堤になるが、/tmp 以外へ移すと無限に溜まる。
 * そのため registry 走査に加えてディスクも走査し、registry に存在せず
 * 更新時刻が MAX_AGE_MS を超えたファイルを回収する。
 */
export async function cleanupOldFiles(): Promise<number> {
  const now = Date.now();
  let cleaned = 0;

  // 1. registry に載っているもの (通常経路)
  for (const [id, entry] of registry) {
    if (now - entry.uploaded_at > MAX_AGE_MS) {
      try { await unlink(entry.path); } catch { /* ignore */ }
      registry.delete(id);
      cleaned++;
    }
  }

  // 2. registry から失われた孤児 (プロセス再起動をまたいだファイル)
  const liveIds = new Set(registry.keys());
  try {
    const names = await readdir(UPLOAD_DIR);
    for (const name of names) {
      const fileId = name.replace(/\.[^.]+$/, "");
      if (liveIds.has(fileId)) continue;
      const full = join(UPLOAD_DIR, name);
      try {
        const s = await stat(full);
        if (now - s.mtimeMs > MAX_AGE_MS) {
          await unlink(full);
          cleaned++;
        }
      } catch { /* ignore */ }
    }
  } catch { /* ignore — UPLOAD_DIR が無い場合など */ }

  return cleaned;
}
