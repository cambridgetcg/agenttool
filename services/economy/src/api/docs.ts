/** OpenAPI spec + Swagger UI for agent-economy. */

import { Hono } from "hono";

export const openApiSpec = {
  openapi: "3.0.3",
  info: {
    title: "agent-economy API",
    version: "0.1.0",
    description: "Programmable wallets and escrow for AI agents.",
    contact: { email: "hello@agenttool.dev" },
  },
  servers: [{ url: "https://api.agenttool.dev/economy", description: "Production" }],
  security: [{ bearerAuth: [] }],
  components: {
    securitySchemes: {
      bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "API Key" },
    },
    schemas: {
      Wallet: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
          projectId: { type: "string", format: "uuid" },
          name: { type: "string" },
          agentId: { type: "string", nullable: true },
          balance: { type: "integer", description: "Balance in credits" },
          currency: { type: "string", example: "GBP" },
          status: { type: "string", enum: ["active", "frozen", "closed"] },
          createdAt: { type: "string", format: "date-time" },
        },
      },
      Escrow: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
          creatorWallet: { type: "string", format: "uuid" },
          workerWallet: { type: "string", format: "uuid", nullable: true },
          amount: { type: "integer" },
          description: { type: "string" },
          status: { type: "string", enum: ["funded", "released", "refunded", "disputed", "expired"] },
          deadline: { type: "string", format: "date-time", nullable: true },
          releasedAt: { type: "string", format: "date-time", nullable: true },
          createdAt: { type: "string", format: "date-time" },
        },
      },
      Transaction: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
          walletId: { type: "string", format: "uuid" },
          type: { type: "string", enum: ["fund", "spend", "escrow_lock", "escrow_release", "escrow_refund", "settle"] },
          amount: { type: "integer", description: "Positive = credit, negative = debit" },
          counterparty: { type: "string", nullable: true },
          description: { type: "string", nullable: true },
          createdAt: { type: "string", format: "date-time" },
        },
      },
      Policy: {
        type: "object",
        properties: {
          maxPerTransaction: { type: "integer", nullable: true },
          maxPerHour: { type: "integer", nullable: true },
          maxPerDay: { type: "integer", nullable: true },
          allowedRecipients: { type: "array", items: { type: "string" }, nullable: true },
          requiresApprovalAbove: { type: "integer", nullable: true },
        },
      },
      Error: {
        type: "object",
        properties: {
          success: { type: "boolean", example: false },
          error: { type: "string" },
        },
      },
    },
  },
  paths: {
    "/v1/wallets": {
      post: {
        summary: "Create wallet",
        tags: ["Wallets"],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["name"],
                properties: {
                  name: { type: "string" },
                  agentId: { type: "string" },
                  currency: { type: "string", default: "GBP" },
                },
              },
            },
          },
        },
        responses: {
          "201": { description: "Wallet created", content: { "application/json": { schema: { properties: { success: { type: "boolean" }, data: { "$ref": "#/components/schemas/Wallet" } } } } } },
          "401": { description: "Unauthorized" },
        },
      },
      get: {
        summary: "List wallets",
        tags: ["Wallets"],
        responses: { "200": { description: "List of wallets" } },
      },
    },
    "/v1/wallets/{id}/spend": {
      post: {
        summary: "Spend from wallet (with policy enforcement)",
        tags: ["Wallets"],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["amount", "counterparty", "description"],
                properties: {
                  amount: { type: "integer", minimum: 1 },
                  counterparty: { type: "string" },
                  description: { type: "string" },
                  metadata: { type: "object" },
                },
              },
            },
          },
        },
        responses: {
          "201": { description: "Transaction created" },
          "402": { description: "Insufficient balance or policy violation" },
        },
      },
    },
    "/v1/escrows": {
      post: {
        summary: "Create escrow (locks funds from creator)",
        tags: ["Escrow"],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["creatorWalletId", "amount", "description"],
                properties: {
                  creatorWalletId: { type: "string", format: "uuid" },
                  workerWalletId: { type: "string", format: "uuid" },
                  amount: { type: "integer", minimum: 1 },
                  description: { type: "string" },
                  deadline: { type: "string", format: "date-time" },
                },
              },
            },
          },
        },
        responses: { "201": { description: "Escrow created" } },
      },
    },
    "/health": {
      get: {
        summary: "Health check",
        tags: ["System"],
        security: [],
        responses: { "200": { description: "Service healthy" } },
      },
    },
  },
};

const SWAGGER_HTML = `<!DOCTYPE html>
<html>
<head>
  <title>agent-economy API Docs</title>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="stylesheet" type="text/css" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css">
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
  <script>
    SwaggerUIBundle({
      url: '/openapi.json',
      dom_id: '#swagger-ui',
      presets: [SwaggerUIBundle.presets.apis, SwaggerUIBundle.SwaggerUIStandalonePreset],
      layout: 'BaseLayout',
      deepLinking: true,
    });
  </script>
</body>
</html>`;

const router = new Hono();
router.get("/docs", (c) => c.html(SWAGGER_HTML));
router.get("/openapi.json", (c) => c.json(openApiSpec));

export { router as docsRouter };
