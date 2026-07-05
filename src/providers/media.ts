// Shared image-input helpers (F031). Extracted from gemini.ts once a second
// provider (vertex.ts) needed the exact same URL/bytes/data-URI → inline
// base64+mime resolution for Veo's `image:{bytesBase64Encoded, mimeType}` field.

/** Resolve an image input to { data(base64), mimeType } — a URL is fetched to bytes. */
export async function toInlineImage(
  image: string | Uint8Array,
  fetchImpl: typeof fetch,
): Promise<{ data: string; mimeType: string }> {
  if (typeof image !== "string") {
    return { data: Buffer.from(image).toString("base64"), mimeType: sniffMime(image) };
  }
  if (/^https?:\/\//i.test(image)) {
    const res = await fetchImpl(image);
    if (!res.ok) throw new Error(`toInlineImage: failed to fetch image (${res.status})`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    const mimeType = res.headers.get("content-type") ?? sniffMime(bytes);
    return { data: Buffer.from(bytes).toString("base64"), mimeType };
  }
  // A data: URI or bare base64.
  const comma = image.startsWith("data:") ? image.indexOf(",") : -1;
  const b64 = comma >= 0 ? image.slice(comma + 1) : image;
  const mimeType = image.startsWith("data:") ? image.slice(5, image.indexOf(";")) : "image/png";
  return { data: b64, mimeType };
}

export function sniffMime(b: Uint8Array): string {
  if (b[0] === 0x89 && b[1] === 0x50) return "image/png";
  if (b[0] === 0x47 && b[1] === 0x49) return "image/gif";
  if (b[0] === 0x52 && b[1] === 0x49 && b[8] === 0x57) return "image/webp";
  return "image/jpeg";
}
