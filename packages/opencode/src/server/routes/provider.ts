import { Hono } from "hono"
import { describeRoute, validator, resolver } from "hono-openapi"
import z from "zod"
import { Config } from "../../config/config"
import { Provider } from "../../provider/provider"
import { ModelsDev } from "../../provider/models"
import { ProviderAuth } from "../../provider/auth"
import { ProviderRateLimit } from "../../provider/rate-limit"
import { ProviderCodexAccount } from "../../provider/codex-account"
import { mapValues } from "remeda"
import { errors } from "../error"
import { lazy } from "../../util/lazy"

export const ProviderRoutes = lazy(() =>
  new Hono()
    .get(
      "/",
      describeRoute({
        summary: "List providers",
        description: "Get a list of all available AI providers, including both available and connected ones.",
        operationId: "provider.list",
        responses: {
          200: {
            description: "List of providers",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    all: ModelsDev.Provider.array(),
                    default: z.record(z.string(), z.string()),
                    connected: z.array(z.string()),
                  }),
                ),
              },
            },
          },
        },
      }),
      async (c) => {
        const config = await Config.get()
        const disabled = new Set(config.disabled_providers ?? [])
        const enabled = config.enabled_providers ? new Set(config.enabled_providers) : undefined

        const allProviders = await ModelsDev.get()
        const filteredProviders: Record<string, (typeof allProviders)[string]> = {}
        for (const [key, value] of Object.entries(allProviders)) {
          if ((enabled ? enabled.has(key) : true) && !disabled.has(key)) {
            filteredProviders[key] = value
          }
        }

        const connected = await Provider.list()
        const providers = Object.assign(
          mapValues(filteredProviders, (x) => Provider.fromModelsDevProvider(x)),
          connected,
        )
        return c.json({
          all: Object.values(providers),
          default: mapValues(providers, (item) => Provider.sort(Object.values(item.models))[0].id),
          connected: Object.keys(connected),
        })
      },
    )
    .get(
      "/auth",
      describeRoute({
        summary: "Get provider auth methods",
        description: "Retrieve available authentication methods for all AI providers.",
        operationId: "provider.auth",
        responses: {
          200: {
            description: "Provider auth methods",
            content: {
              "application/json": {
                schema: resolver(z.record(z.string(), z.array(ProviderAuth.Method))),
              },
            },
          },
        },
      }),
      async (c) => {
        return c.json(await ProviderAuth.methods())
      },
    )
    .get(
      "/:providerID/rate-limits",
      describeRoute({
        summary: "Get provider rate limits",
        description: "Retrieve the current rate-limit snapshot for a provider when available.",
        operationId: "provider.rate_limits",
        responses: {
          200: {
            description: "Provider rate-limit snapshot",
            content: {
              "application/json": {
                schema: resolver(
                  z
                    .object({
                      limitId: z.string().nullable(),
                      limitName: z.string().nullable(),
                      primary: z
                        .object({
                          usedPercent: z.number(),
                          windowDurationMins: z.number().nullable(),
                          resetsAt: z.number().nullable(),
                        })
                        .nullable(),
                      secondary: z
                        .object({
                          usedPercent: z.number(),
                          windowDurationMins: z.number().nullable(),
                          resetsAt: z.number().nullable(),
                        })
                        .nullable(),
                      planType: z.string().nullable(),
                    })
                    .nullable(),
                ),
              },
            },
          },
        },
      }),
      validator(
        "param",
        z.object({
          providerID: z.string().meta({ description: "Provider ID" }),
        }),
      ),
      async (c) => {
        const { providerID } = c.req.valid("param")
        if (providerID !== "openai") return c.json(null)
        return c.json(await ProviderRateLimit.getOpenAI())
      },
    )
    .get(
      "/:providerID/account",
      describeRoute({
        summary: "Get provider account",
        description: "Retrieve active account, saved profiles, and usage snapshot for a provider.",
        operationId: "provider.account",
        responses: {
          200: {
            description: "Provider account and usage",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    current: z
                      .object({
                        id: z.string().nullable(),
                        label: z.string().nullable(),
                        email: z.string().nullable(),
                        accountId: z.string().nullable(),
                      })
                      .nullable(),
                    profiles: z.array(
                      z.object({
                        id: z.string(),
                        label: z.string(),
                        email: z.string().nullable(),
                        accountId: z.string().nullable(),
                        active: z.boolean(),
                      }),
                    ),
                    usage: z
                      .object({
                        limitId: z.string().nullable(),
                        limitName: z.string().nullable(),
                        primary: z
                          .object({
                            usedPercent: z.number(),
                            windowDurationMins: z.number().nullable(),
                            resetsAt: z.number().nullable(),
                          })
                          .nullable(),
                        secondary: z
                          .object({
                            usedPercent: z.number(),
                            windowDurationMins: z.number().nullable(),
                            resetsAt: z.number().nullable(),
                          })
                          .nullable(),
                        planType: z.string().nullable(),
                      })
                      .nullable(),
                    error: z.string().optional(),
                  }),
                ),
              },
            },
          },
        },
      }),
      validator(
        "param",
        z.object({
          providerID: z.string().meta({ description: "Provider ID" }),
        }),
      ),
      async (c) => {
        const { providerID } = c.req.valid("param")
        if (providerID !== "openai") {
          return c.json({
            current: null,
            profiles: [],
            usage: null,
            error: `Provider does not support account switching: ${providerID}`,
          })
        }
        return c.json(await ProviderCodexAccount.status())
      },
    )
    .post(
      "/:providerID/account/swap",
      describeRoute({
        summary: "Swap provider account",
        description: "Cycle or switch to a saved provider account profile.",
        operationId: "provider.account.swap",
        responses: {
          200: {
            description: "Updated provider account status",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    current: z
                      .object({
                        id: z.string().nullable(),
                        label: z.string().nullable(),
                        email: z.string().nullable(),
                        accountId: z.string().nullable(),
                      })
                      .nullable(),
                    profiles: z.array(
                      z.object({
                        id: z.string(),
                        label: z.string(),
                        email: z.string().nullable(),
                        accountId: z.string().nullable(),
                        active: z.boolean(),
                      }),
                    ),
                    usage: z
                      .object({
                        limitId: z.string().nullable(),
                        limitName: z.string().nullable(),
                        primary: z
                          .object({
                            usedPercent: z.number(),
                            windowDurationMins: z.number().nullable(),
                            resetsAt: z.number().nullable(),
                          })
                          .nullable(),
                        secondary: z
                          .object({
                            usedPercent: z.number(),
                            windowDurationMins: z.number().nullable(),
                            resetsAt: z.number().nullable(),
                          })
                          .nullable(),
                        planType: z.string().nullable(),
                      })
                      .nullable(),
                    error: z.string().optional(),
                  }),
                ),
              },
            },
          },
        },
      }),
      validator(
        "param",
        z.object({
          providerID: z.string().meta({ description: "Provider ID" }),
        }),
      ),
      validator(
        "json",
        z.object({
          action: z.enum(["next", "use", "add", "status"]),
          selector: z.string().optional(),
          label: z.string().optional(),
        }),
      ),
      async (c) => {
        const { providerID } = c.req.valid("param")
        const input = c.req.valid("json")

        if (providerID !== "openai") {
          return c.json({
            current: null,
            profiles: [],
            usage: null,
            error: `Provider does not support account switching: ${providerID}`,
          })
        }

        if (input.action === "status") return c.json(await ProviderCodexAccount.status())
        if (input.action === "next") return c.json(await ProviderCodexAccount.next())
        if (input.action === "add") return c.json(await ProviderCodexAccount.add(input.label))
        if (!input.selector) {
          const status = await ProviderCodexAccount.status()
          return c.json({ ...status, error: "Missing selector for /codexswap use" })
        }
        return c.json(await ProviderCodexAccount.use(input.selector))
      },
    )
    .post(
      "/:providerID/oauth/authorize",
      describeRoute({
        summary: "OAuth authorize",
        description: "Initiate OAuth authorization for a specific AI provider to get an authorization URL.",
        operationId: "provider.oauth.authorize",
        responses: {
          200: {
            description: "Authorization URL and method",
            content: {
              "application/json": {
                schema: resolver(ProviderAuth.Authorization.optional()),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator(
        "param",
        z.object({
          providerID: z.string().meta({ description: "Provider ID" }),
        }),
      ),
      validator(
        "json",
        z.object({
          method: z.number().meta({ description: "Auth method index" }),
        }),
      ),
      async (c) => {
        const providerID = c.req.valid("param").providerID
        const { method } = c.req.valid("json")
        const result = await ProviderAuth.authorize({
          providerID,
          method,
        })
        return c.json(result)
      },
    )
    .post(
      "/:providerID/oauth/callback",
      describeRoute({
        summary: "OAuth callback",
        description: "Handle the OAuth callback from a provider after user authorization.",
        operationId: "provider.oauth.callback",
        responses: {
          200: {
            description: "OAuth callback processed successfully",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator(
        "param",
        z.object({
          providerID: z.string().meta({ description: "Provider ID" }),
        }),
      ),
      validator(
        "json",
        z.object({
          method: z.number().meta({ description: "Auth method index" }),
          code: z.string().optional().meta({ description: "OAuth authorization code" }),
        }),
      ),
      async (c) => {
        const providerID = c.req.valid("param").providerID
        const { method, code } = c.req.valid("json")
        await ProviderAuth.callback({
          providerID,
          method,
          code,
        })
        return c.json(true)
      },
    ),
)
