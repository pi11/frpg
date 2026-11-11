// Mirror of content_digest in server/app/services/content.py: SHA-256 over
// `<path>\n<byte length>\n<bytes>` for every content file in path order.

const rawFiles = import.meta.glob<string>('../../../content/**/*.json', {
  eager: true, query: '?raw', import: 'default',
});

function normalizePath(path: string): string {
  return path.replace(/^(\.\.\/)+/, '');
}

export async function contentDigest(files: Record<string, string>): Promise<string> {
  const encoder = new TextEncoder();
  const parts: Uint8Array[] = [];
  for (const path of Object.keys(files).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))) {
    const data = encoder.encode(files[path]!);
    parts.push(encoder.encode(`${path}\n${data.length}\n`), data);
  }
  const buffer = new Uint8Array(parts.reduce((size, part) => size + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    buffer.set(part, offset);
    offset += part.length;
  }
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', buffer));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

let cached: Promise<string> | undefined;

export function bundledContentHash(): Promise<string> {
  cached ??= contentDigest(Object.fromEntries(
    Object.entries(rawFiles).map(([path, text]) => [normalizePath(path), text]),
  ));
  return cached;
}
