// ╔══════════════════════════════════════════════════════════════════════╗
// ║  CORE ENGINE — DO NOT MODIFY                                         ║
// ║  Defines the placeOrder action: input validation + API call.         ║
// ║  UI customisation belongs in components, not here.                   ║
// ╚══════════════════════════════════════════════════════════════════════╝
import { ActionError, defineAction } from "astro:actions";
import { placeOrder } from "@/core/api/client";
import { placeOrderInput } from "./input";

export const server = {
  placeOrder: defineAction({
    accept: "form",
    input: placeOrderInput,
    handler: async (input, context) => {
      // An order is either a basket or a single product, never neither. The
      // schema above cannot express that (form parsing needs a plain object),
      // and cod-server refuses the shape anyway — failing here turns a bare
      // 400 into a field error the form can actually render.
      if (!input.items?.length && (!input.productId || !input.productName || !input.pricePerUnit)) {
        throw new ActionError({
          code: "BAD_REQUEST",
          message: "An order needs either a basket or a product.",
        });
      }

      // Forward the shopper's attribution headers so cod-server records the
      // visitor, not this worker — same mechanism as core/endpoints/abandoned.ts.
      const forwardedHeaders: Record<string, string> = {};
      const userAgent = context.request.headers.get("User-Agent");
      if (userAgent) forwardedHeaders["User-Agent"] = userAgent;
      const clientIp =
        context.request.headers.get("CF-Connecting-IP") ??
        context.request.headers.get("X-Forwarded-For")?.split(",")[0]?.trim();
      if (clientIp) forwardedHeaders["X-Forwarded-For"] = clientIp;
      const referer = context.request.headers.get("Referer");
      if (referer) forwardedHeaders["Referer"] = referer;

      const result = await placeOrder({
        customerName: input.customerName,
        phone: input.phone,
        wilayaId: input.wilayaId,
        communeId: input.communeId,
        address: input.address,
        deliveryType: input.deliveryType,
        productId: input.productId,
        productName: input.productName,
        variantId: input.variantId,
        variantLabel: input.variantLabel,
        quantity: input.quantity,
        pricePerUnit: input.pricePerUnit,
        notes: input.notes,
        email: input.email,
        customFieldResponses: input.customFieldResponses,
        offerId: input.offerId,
        variantSelections: input.variantSelections,
        items: input.items,
        fbc: input.fbc,
        fbp: input.fbp,
        otpToken: input.otpToken,
        turnstileToken: input.turnstileToken,
        landingPageSlug: input.landingPageSlug,
      }, forwardedHeaders);

      if (!result.success) {
        throw new Error(result.error);
      }

      return result.data;
    },
  }),
};
