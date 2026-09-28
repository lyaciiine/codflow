/**
 * WhatsApp prefill message resolution for the storefront.
 * Resolves tokens ({product}, {url}, {order}, {store}), strips ad tracking params,
 * and enforces the 900-character word-boundary cap before encoding.
 */

export function stripTrackingParams(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    const keysToDelete: string[] = [];
    url.searchParams.forEach((_, key) => {
      const lower = key.toLowerCase();
      if (lower.startsWith("utm_") || lower.endsWith("clid") || lower === "fbclid") {
        keysToDelete.push(key);
      }
    });
    for (const key of keysToDelete) {
      url.searchParams.delete(key);
    }
    return url.toString();
  } catch {
    return rawUrl;
  }
}

export function truncateAtWordBoundary(text: string, maxLen = 900): string {
  if (text.length <= maxLen) return text;
  const sliced = text.slice(0, maxLen);
  const lastSpace = sliced.lastIndexOf(" ");
  if (lastSpace > 0) {
    return sliced.slice(0, lastSpace).trimEnd();
  }
  return sliced;
}

export interface ResolvePrefillParams {
  template: string;
  storeName: string;
  productName?: string | null;
  url?: string;
  orderNumber?: string | null;
}

export function resolvePrefillText({
  template,
  storeName,
  productName,
  url,
  orderNumber,
}: ResolvePrefillParams): string {
  const cleanUrl = url ? stripTrackingParams(url) : "";
  const product = productName && productName.trim() ? productName.trim() : storeName;
  const order = orderNumber ? orderNumber.trim() : "";

  const resolved = template
    .replaceAll("{store}", storeName)
    .replaceAll("{product}", product)
    .replaceAll("{url}", cleanUrl)
    .replaceAll("{order}", order);

  return truncateAtWordBoundary(resolved, 900);
}

export function buildWhatsAppHref(baseHref: string, text: string): string {
  if (!text) return baseHref;
  const separator = baseHref.includes("?") ? "&" : "?";
  return `${baseHref}${separator}text=${encodeURIComponent(text)}`;
}
