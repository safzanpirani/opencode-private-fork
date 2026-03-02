import { Auth } from "@/auth"
import { Installation } from "@/installation"
import os from "os"

const CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann"
const TOKEN_ENDPOINT = "https://auth.openai.com/oauth/token"
const USAGE_ENDPOINT = "https://chatgpt.com/backend-api/wham/usage"

export namespace ProviderRateLimit {
  export interface Window {
    usedPercent: number
    windowDurationMins: number | null
    resetsAt: number | null
  }

  export interface Snapshot {
    limitId: string | null
    limitName: string | null
    primary: Window | null
    secondary: Window | null
    planType: string | null
  }

  interface TokenResponse {
    access_token: string
    refresh_token: string
    expires_in?: number
    id_token?: string
  }

  interface Claims {
    chatgpt_account_id?: string
    organizations?: Array<{ id?: string }>
    "https://api.openai.com/auth"?: {
      chatgpt_account_id?: string
    }
  }

  function object(input: unknown): Record<string, unknown> | undefined {
    if (!input || typeof input !== "object" || Array.isArray(input)) return
    return input as Record<string, unknown>
  }

  function parseJwtClaims(token: string): Claims | undefined {
    const parts = token.split(".")
    if (parts.length !== 3) return
    try {
      const decoded = Buffer.from(parts[1], "base64url").toString()
      const parsed = JSON.parse(decoded)
      return object(parsed) as Claims | undefined
    } catch {
      return
    }
  }

  function extractAccountIdFromClaims(claims: Claims): string | undefined {
    if (typeof claims.chatgpt_account_id === "string") return claims.chatgpt_account_id
    const auth = claims["https://api.openai.com/auth"]
    if (auth && typeof auth.chatgpt_account_id === "string") return auth.chatgpt_account_id
    const first = claims.organizations?.[0]
    if (first && typeof first.id === "string") return first.id
    return
  }

  function extractAccountId(tokens: TokenResponse): string | undefined {
    if (tokens.id_token) {
      const claims = parseJwtClaims(tokens.id_token)
      if (claims) {
        const accountId = extractAccountIdFromClaims(claims)
        if (accountId) return accountId
      }
    }

    const claims = parseJwtClaims(tokens.access_token)
    if (!claims) return
    return extractAccountIdFromClaims(claims)
  }

  async function refresh(refreshToken: string): Promise<TokenResponse | undefined> {
    const response = await fetch(TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: CLIENT_ID,
      }).toString(),
    }).catch(() => undefined)

    if (!response?.ok) return

    const json = await response.json().catch(() => undefined)
    const parsed = object(json)
    if (!parsed) return

    if (typeof parsed.access_token !== "string") return
    if (typeof parsed.refresh_token !== "string") return

    return {
      access_token: parsed.access_token,
      refresh_token: parsed.refresh_token,
      expires_in: typeof parsed.expires_in === "number" ? parsed.expires_in : undefined,
      id_token: typeof parsed.id_token === "string" ? parsed.id_token : undefined,
    }
  }

  async function resolveAccessToken() {
    const current = await Auth.get("openai")
    if (!current || current.type !== "oauth") return

    if (current.access && current.expires > Date.now() + 30_000) {
      return {
        access: current.access,
        accountId: current.accountId,
      }
    }

    const tokens = await refresh(current.refresh)
    if (!tokens) return

    const accountId = extractAccountId(tokens) ?? current.accountId
    await Auth.set("openai", {
      type: "oauth",
      refresh: tokens.refresh_token,
      access: tokens.access_token,
      expires: Date.now() + (tokens.expires_in ?? 3600) * 1000,
      ...(accountId ? { accountId } : {}),
      ...(current.enterpriseUrl ? { enterpriseUrl: current.enterpriseUrl } : {}),
    })

    return {
      access: tokens.access_token,
      accountId,
    }
  }

  function parseWindow(input: unknown): Window | null {
    const raw = object(input)
    if (!raw) return null

    const usedPercent = typeof raw.used_percent === "number" ? raw.used_percent : undefined
    if (usedPercent === undefined) return null

    const windowSeconds = typeof raw.limit_window_seconds === "number" ? raw.limit_window_seconds : null
    const resetsAt = typeof raw.reset_at === "number" ? raw.reset_at : null

    return {
      usedPercent,
      windowDurationMins: windowSeconds === null ? null : Math.max(1, Math.round(windowSeconds / 60)),
      resetsAt,
    }
  }

  function parseSnapshot(input: unknown): Snapshot | null {
    const raw = object(input)
    if (!raw) return null

    const rateLimit = object(raw.rate_limit)
    const primary = parseWindow(rateLimit?.primary_window)
    const secondary = parseWindow(rateLimit?.secondary_window)

    if (!primary && !secondary) return null

    return {
      limitId: "codex",
      limitName: null,
      primary,
      secondary,
      planType: typeof raw.plan_type === "string" ? raw.plan_type : null,
    }
  }

  export async function getOpenAI(): Promise<Snapshot | null> {
    const auth = await resolveAccessToken()
    if (!auth) return null

    const headers = new Headers({
      authorization: `Bearer ${auth.access}`,
      "User-Agent": `opencode/${Installation.VERSION} (${os.platform()} ${os.release()}; ${os.arch()})`,
    })

    if (auth.accountId) headers.set("ChatGPT-Account-Id", auth.accountId)

    const response = await fetch(USAGE_ENDPOINT, {
      method: "GET",
      headers,
    }).catch(() => undefined)

    if (!response?.ok) return null

    const body = await response.json().catch(() => undefined)
    return parseSnapshot(body)
  }
}
