const encoder = new TextEncoder();

async function sha256(value: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
}

/**
 * Workers exposes timingSafeEqual. The fixed-length XOR fallback keeps the
 * source testable in Node, whose Web Crypto implementation does not expose it.
 */
function constantTimeEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (typeof crypto.subtle.timingSafeEqual === "function") {
    return crypto.subtle.timingSafeEqual(left, right);
  }

  let difference = left.byteLength ^ right.byteLength;
  const length = Math.max(left.byteLength, right.byteLength);
  for (let index = 0; index < length; index += 1) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return difference === 0;
}

export async function isAuthorizedSyncRequest(request: Request, token: string | undefined): Promise<boolean> {
  if (!token) return false;
  const provided = await sha256(request.headers.get("authorization") ?? "");
  const expected = await sha256(`Bearer ${token}`);
  return constantTimeEqual(provided, expected);
}
