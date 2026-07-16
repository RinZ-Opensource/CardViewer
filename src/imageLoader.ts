export const THUMBNAIL_BUFFER_ROWS = 24;

export function isStaticAssetPath(path: string) {
  return (
    path.startsWith("/") ||
    path.startsWith("http://") ||
    path.startsWith("https://") ||
    path.startsWith("data:")
  );
}

export function resolveWebImageUrl(path: string): Promise<string> {
  if (isStaticAssetPath(path)) return Promise.resolve(path);
  return Promise.reject(new Error(`Unsupported non-web image path: ${path}`));
}
