// ╔══════════════════════════════════════════════════════════════════════╗
// ║  CORE ENGINE — DO NOT MODIFY                                         ║
// ║  The placeOrder input whitelist: the one list of fields an order      ║
// ║  form may submit. Kept apart from the action so it can be tested      ║
// ║  without the server-only API client the action pulls in.              ║
// ╚══════════════════════════════════════════════════════════════════════╝
import { z } from "astro/zod";

/**
 * The order form's input whitelist.
 *
 * Exported so it can be tested directly: zod STRIPS every key this schema does
 * not name, which is why a field the storefront renders but this schema forgets
 * silently never reaches cod-server. `placeOrderInput.test.ts` pins that.
 */
export const placeOrderInput = z.object({
    // Optional because a basket order has no single representative product;
    // the handler below requires them whenever `items` is absent. They stay
    // on a plain z.object rather than a .superRefine() because `accept:
    // "form"` needs an object schema to parse FormData with.
    productId: z.preprocess(
      (v) => (v === "" || v == null ? undefined : v),
      z.string().min(1).optional()
    ),
    productName: z.preprocess(
      (v) => (v === "" || v == null ? undefined : v),
      z.string().min(1).optional()
    ),
    // Forms always submit all hidden inputs — empty string must become undefined
    variantId: z.preprocess(
      (v) => (v === "" || v == null ? undefined : v),
      z.string().min(1).optional()
    ),
    variantLabel: z.preprocess(
      (v) => (v === "" || v == null ? undefined : v),
      z.string().optional()
    ),
    pricePerUnit: z.preprocess(
      (v) => (v === "" || v == null ? undefined : v),
      z.coerce.number().positive().optional()
    ),
    quantity: z.coerce.number().int().min(1).max(100).default(1),
    // Explicit offer tier selected by the user
    offerId: z.preprocess(
      (v) => (v === "" || v == null ? undefined : v),
      z.string().optional()
    ),
    // Per-unit variant selections — JSON string from hidden form input
    variantSelections: z.preprocess(
      (v) => {
        if (!v || typeof v !== "string" || v === "[]") return undefined;
        try { return JSON.parse(v as string); } catch { return undefined; }
      },
      z.array(z.object({
        variantId: z.string().min(1),
        variantLabel: z.string().optional(),
      })).optional()
    ),
    customerName: z.string().min(2, "الاسم مطلوب"),
    phone: z
      .string()
      .min(9, "رقم الهاتف غير صحيح")
      .max(20)
      .regex(/^[0-9+\s-]+$/, "رقم الهاتف غير صحيح"),
    wilayaId: z.coerce.number().int().min(1).max(58),
    communeId: z.string().min(1, "يرجى اختيار البلدية"),
    address: z.string().max(300).optional(),
    deliveryType: z.enum(["home", "stop_desk"]).default("home"),
    notes: z.string().max(500).optional(),
    // Checkout Form Policy fields. This schema is a whitelist — anything not
    // named here is stripped before the order reaches cod-server — so both
    // keys must exist even though whether they are asked for, and whether
    // they may be empty, is the merchant's policy and cod-server's ruling.
    // Validated permissively on purpose: a stricter rule here would reject
    // with this worker's message instead of the store-language one cod-server
    // returns, and would be a second definition of the same rule.
    email: z.preprocess(
      (v) => (v === "" || v == null ? undefined : v),
      z.string().max(254).optional()
    ),
    // One JSON field rather than one input per custom field, precisely
    // because of this whitelist: a merchant adding a field must never require
    // a theme deploy.
    customFieldResponses: z.preprocess(
      (v) => (v === "" || v == null || v === "[]" ? undefined : v),
      z.string().max(4000).optional()
    ),
    fbc: z.preprocess(
      (v) => (v === "" || v == null ? undefined : v),
      z.string().optional()
    ),
    fbp: z.preprocess(
      (v) => (v === "" || v == null ? undefined : v),
      z.string().optional()
    ),
    // WhatsApp OTP verification proof — set after the OTP step verifies.
    // Absent when the store has verification disabled (schema stays additive).
    otpToken: z.preprocess(
      (v) => (v === "" || v == null ? undefined : v),
      z.string().min(10).max(1024).optional()
    ),
    // Cloudflare Turnstile proof — auto-injected by the widget's hidden input
    // when the store enables bot protection. Absent when disabled (additive).
    // Tokens are single-use, max 2048 chars, and expire after 300 seconds.
    turnstileToken: z.preprocess(
      (v) => (v === "" || v == null ? undefined : v),
      z.string().min(1).max(2048).optional()
    ),
    // Cart basket. Present only when checkout started from the drawer; an
    // empty or malformed value falls through to the flat single-product
    // fields above, so the direct order form is untouched by this.
    items: z.preprocess(
      (v) => {
        if (!v || typeof v !== "string" || v === "[]") return undefined;
        try {
          const parsed = JSON.parse(v);
          return Array.isArray(parsed) && parsed.length > 0 ? parsed : undefined;
        } catch { return undefined; }
      },
      z.array(z.object({
        productId: z.string().min(1),
        productName: z.string().min(1),
        variantId: z.string().min(1).optional(),
        variantLabel: z.string().optional(),
        quantity: z.coerce.number().int().min(1).max(100),
        pricePerUnit: z.coerce.number().nonnegative().optional(),
      })).optional()
    ),
    // Landing page attribution — best-effort: unknown/draft slug leaves
    // the order unattributed, never blocked (platform extension, LP feature).
    landingPageSlug: z.preprocess(
      (v) => (v === "" || v == null ? undefined : v),
      z.string().min(1).max(60).optional()
    ),
});
