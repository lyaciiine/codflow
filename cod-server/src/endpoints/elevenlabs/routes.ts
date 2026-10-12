import { OpenAPIHono, z } from "@hono/zod-openapi";
import type { AppContext } from "@/types";
import { defineRoute } from "@/lib/route-builder";
import { SCOPES } from "../../../../cod-shared/rbac/scopes";
import { IdParamSchema } from "@/openapi/schemas";
import { handleWebhook, requestTestCall } from "./handlers";

const router = new OpenAPIHono<AppContext>();

const requestCallRoute = defineRoute({
  method: "post",
  path: "/orders/{id}/test-call",
  auth: { scope: SCOPES.ORDERS_UPDATE },
  params: IdParamSchema,
  tags: ["ElevenLabs"],
  summary: "Record a test call request",
  description: "Records a test call request. Outbound execution is disabled until the provider and agent are configured.",
  operationId: "requestElevenLabsTestCall",
  responses: {
    202: {
      description: "Request recorded without starting an outbound call",
      content: { "application/json": { schema: z.object({
        success: z.boolean(),
        data: z.object({
          callId: z.string(),
          status: z.string(),
          executionStarted: z.boolean(),
        }),
      }) } },
    },
  },
  handler: requestTestCall,
});

router.openapi(requestCallRoute.route, requestCallRoute.handler);

export default router;
