/** GET /docs — Swagger UI for the agent-tools API. */

import { Hono } from "hono";
import { swaggerUI } from "@hono/swagger-ui";

const docsRouter = new Hono();

const openApiSpec = {
  openapi: "3.1.0",
  info: {
    title: "agent-tools API",
    version: "0.1.0",
    description:
      "The OS for your agent's tools. Reliable search, scrape, browse, document parsing, and code execution for AI agents.",
    contact: { email: "hello@agenttool.dev" },
  },
  servers: [
    { url: "http://localhost:3000", description: "Local development" },
  ],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: "http",
        scheme: "bearer",
        description: "API key (at_...)",
      },
    },
    schemas: {
      Error: {
        type: "object",
        properties: {
          error: { type: "string" },
        },
      },
    },
  },
  security: [{ bearerAuth: [] }],
  paths: {
    "/health": {
      get: {
        tags: ["System"],
        summary: "Health check",
        security: [],
        responses: {
          "200": {
            description: "Service health",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    status: { type: "string", enum: ["ok", "degraded"] },
                    version: { type: "string" },
                    checks: {
                      type: "object",
                      properties: {
                        database: { type: "object", properties: { status: { type: "string" }, latency_ms: { type: "number" } } },
                        redis: { type: "object", properties: { status: { type: "string" }, latency_ms: { type: "number" } } },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    "/v1/search": {
      post: {
        tags: ["Tools"],
        summary: "Web search",
        description: "Search the web via Brave Search API. Cached results (1h TTL). Cost: 1 credit.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["query"],
                properties: {
                  query: { type: "string", minLength: 1, maxLength: 500 },
                  num_results: { type: "integer", minimum: 1, maximum: 20, default: 5 },
                  freshness: { type: "string", enum: ["pd", "pw", "pm", "py"] },
                  country: { type: "string", minLength: 2, maxLength: 2 },
                },
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Search results",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    results: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          title: { type: "string" },
                          url: { type: "string" },
                          snippet: { type: "string" },
                          date: { type: "string" },
                        },
                      },
                    },
                    cached: { type: "boolean" },
                    duration_ms: { type: "integer" },
                  },
                },
              },
            },
          },
          "402": { description: "Insufficient credits" },
        },
      },
    },
    "/v1/scrape": {
      post: {
        tags: ["Tools"],
        summary: "Scrape a URL",
        description: "Fetch and parse HTML. Optional CSS selector or JSON schema extraction. Cost: 2 credits.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["url"],
                properties: {
                  url: { type: "string", format: "uri" },
                  selector: { type: "string" },
                  schema: { type: "object", description: "JSON schema for structured extraction" },
                  follow_pagination: { type: "boolean", default: false },
                },
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Scraped content",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    url: { type: "string" },
                    content: { type: "string" },
                    extracted: { type: "object" },
                    links: { type: "array", items: { type: "string" } },
                    fetched_at: { type: "string", format: "date-time" },
                    duration_ms: { type: "integer" },
                  },
                },
              },
            },
          },
          "402": { description: "Insufficient credits" },
        },
      },
    },
    "/v1/browse": {
      post: {
        tags: ["Tools"],
        summary: "Browser automation",
        description: "Managed Playwright session with proxy rotation. Sync if <5s, async otherwise. Cost: 5 credits/page.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["url"],
                properties: {
                  url: { type: "string", format: "uri" },
                  actions: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        type: { type: "string", enum: ["click", "type", "scroll", "wait", "select"] },
                        selector: { type: "string" },
                        text: { type: "string" },
                        value: { type: "string" },
                      },
                    },
                  },
                  extract: { type: "string", description: "CSS selector or 'text' for full page text" },
                  screenshot: { type: "boolean", default: false },
                },
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Browse result (sync)",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    result: { type: "object" },
                    screenshot_url: { type: "string" },
                    duration_ms: { type: "integer" },
                  },
                },
              },
            },
          },
          "202": {
            description: "Job queued (async)",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    job_id: { type: "string" },
                    status: { type: "string", enum: ["queued"] },
                  },
                },
              },
            },
          },
          "402": { description: "Insufficient credits" },
        },
      },
    },
    "/v1/document": {
      post: {
        tags: ["Tools"],
        summary: "Parse a document",
        description: "Extract text + metadata from PDF, DOCX, or HTML. Cost: 3 credits.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  url: { type: "string", format: "uri" },
                  base64: { type: "string" },
                  filename: { type: "string" },
                },
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Parsed document",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    text: { type: "string" },
                    title: { type: "string" },
                    metadata: { type: "object" },
                    page_count: { type: "integer" },
                    duration_ms: { type: "integer" },
                  },
                },
              },
            },
          },
          "402": { description: "Insufficient credits" },
        },
      },
    },
    "/v1/execute": {
      post: {
        tags: ["Tools"],
        summary: "Execute code in sandbox",
        description: "Run Python, Node.js, or bash in an isolated Docker container. Cost: 1 credit per 10s.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["language", "code"],
                properties: {
                  language: { type: "string", enum: ["python", "node", "bash"] },
                  code: { type: "string" },
                  stdin: { type: "string" },
                  timeout_ms: { type: "integer", default: 10000, maximum: 30000 },
                  allow_network: { type: "boolean", default: false },
                },
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Execution result",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    stdout: { type: "string" },
                    stderr: { type: "string" },
                    exit_code: { type: "integer" },
                    duration_ms: { type: "integer" },
                  },
                },
              },
            },
          },
          "402": { description: "Insufficient credits" },
        },
      },
    },
    "/v1/jobs/{job_id}": {
      get: {
        tags: ["Jobs"],
        summary: "Poll async job status",
        description: "Check status of an async browse or execute job.",
        parameters: [{ name: "job_id", in: "path", required: true, schema: { type: "string" } }],
        responses: {
          "200": {
            description: "Job status",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    job_id: { type: "string" },
                    status: { type: "string", enum: ["queued", "active", "completed", "failed"] },
                    result: { type: "object" },
                    error: { type: "string" },
                  },
                },
              },
            },
          },
        },
      },
    },
    "/v1/usage": {
      get: {
        tags: ["Account"],
        summary: "Usage & credit balance",
        responses: {
          "200": {
            description: "Current usage",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    credits_remaining: { type: "integer" },
                    plan: { type: "string" },
                    events_today: { type: "integer" },
                    events_month: { type: "integer" },
                  },
                },
              },
            },
          },
        },
      },
    },
    "/v1/projects": {
      post: {
        tags: ["Account"],
        summary: "Create a project",
        description: "Create a new project and receive your first API key.",
        security: [],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["name"],
                properties: {
                  name: { type: "string", minLength: 1, maxLength: 100 },
                },
              },
            },
          },
        },
        responses: {
          "201": {
            description: "Project created",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    project_id: { type: "string", format: "uuid" },
                    api_key: { type: "string", description: "Store this — it won't be shown again" },
                    plan: { type: "string" },
                    credits: { type: "integer" },
                  },
                },
              },
            },
          },
        },
      },
    },
    "/v1/billing/checkout": {
      post: {
        tags: ["Billing"],
        summary: "Create Stripe checkout session",
        description: "Upgrade plan or buy credit bundle.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["price_id"],
                properties: {
                  price_id: { type: "string" },
                  success_url: { type: "string", format: "uri" },
                  cancel_url: { type: "string", format: "uri" },
                },
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Checkout session",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    checkout_url: { type: "string" },
                  },
                },
              },
            },
          },
        },
      },
    },
    "/v1/billing/crypto": {
      get: {
        tags: ["Billing"],
        summary: "Get USDC deposit address",
        description: "Receive a unique deposit address for USDC on Base. Credits are added on confirmation.",
        responses: {
          "200": {
            description: "Deposit info",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    address: { type: "string" },
                    network: { type: "string", enum: ["base"] },
                    token: { type: "string", enum: ["USDC"] },
                    rate: { type: "string", description: "Credits per USDC" },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
  tags: [
    { name: "Tools", description: "Core tool endpoints — search, scrape, browse, document, execute" },
    { name: "Jobs", description: "Async job polling" },
    { name: "Account", description: "Project and API key management" },
    { name: "Billing", description: "Stripe subscriptions, credit bundles, crypto payments" },
    { name: "System", description: "Health and status" },
  ],
};

// Serve the OpenAPI JSON spec
docsRouter.get("/openapi.json", (c) => c.json(openApiSpec));

// Serve Swagger UI
docsRouter.get("/docs", swaggerUI({ url: "/openapi.json" }));

export default docsRouter;
