import { Auth } from "@/auth"
import { Global } from "@/global"
import { Filesystem } from "@/util/filesystem"
import path from "path"
import { ProviderRateLimit } from "./rate-limit"

type OAuth = Extract<Auth.Info, { type: "oauth" }>

type Profile = {
  id: string
  label: string
  savedAt: number
  email: string | null
  accountId: string | null
  oauth: OAuth
}

type Store = {
  version: 1
  activeProfileId?: string
  profiles: Profile[]
}

export namespace ProviderCodexAccount {
  export type Current = {
    id: string | null
    label: string | null
    email: string | null
    accountId: string | null
  }

  export type Entry = {
    id: string
    label: string
    email: string | null
    accountId: string | null
    active: boolean
  }

  export type Status = {
    current: Current | null
    profiles: Entry[]
    usage: ProviderRateLimit.Snapshot | null
    error?: string
  }

  const file = path.join(Global.Path.data, "codexswap.json")

  function object(input: unknown): Record<string, unknown> | undefined {
    if (!input || typeof input !== "object" || Array.isArray(input)) return
    return input as Record<string, unknown>
  }

  function decodeJwt(token?: string) {
    if (!token) return
    const parts = token.split(".")
    if (parts.length !== 3) return
    const parsed = Buffer.from(parts[1], "base64url").toString("utf8")
    const json = JSON.parse(parsed)
    return object(json)
  }

  function inferEmail(oauth: OAuth) {
    const payload = decodeJwt(oauth.access)
    if (!payload) return null
    const profile = object(payload["https://api.openai.com/profile"])
    if (profile && typeof profile.email === "string") return profile.email
    if (typeof payload.email === "string") return payload.email
    return null
  }

  function id() {
    return `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
  }

  function cleanLabel(input: string) {
    return input.trim().replace(/\s+/g, " ")
  }

  function uniqueLabel(profiles: Profile[], label: string, exclude?: string) {
    const base = cleanLabel(label) || "profile"
    const taken = new Set(profiles.filter((p) => p.id !== exclude).map((p) => p.label.toLowerCase()))
    if (!taken.has(base.toLowerCase())) return base
    let index = 2
    while (taken.has(`${base} ${index}`.toLowerCase())) index++
    return `${base} ${index}`
  }

  function defaultLabel(oauth: OAuth, profiles: Profile[]) {
    const email = inferEmail(oauth)
    if (email) return uniqueLabel(profiles, email.split("@")[0] || "profile")
    if (oauth.accountId) return uniqueLabel(profiles, `codex-${oauth.accountId.slice(0, 8)}`)
    return uniqueLabel(profiles, "codex")
  }

  function parseOauth(input: unknown): OAuth | null {
    const raw = object(input)
    if (!raw) return null
    if (raw.type !== "oauth") return null
    if (typeof raw.refresh !== "string") return null
    if (typeof raw.access !== "string") return null
    if (typeof raw.expires !== "number") return null
    const result: OAuth = {
      type: "oauth",
      refresh: raw.refresh,
      access: raw.access,
      expires: raw.expires,
    }
    if (typeof raw.accountId === "string") result.accountId = raw.accountId
    if (typeof raw.enterpriseUrl === "string") result.enterpriseUrl = raw.enterpriseUrl
    return result
  }

  function parseProfile(input: unknown): Profile | null {
    const raw = object(input)
    if (!raw) return null
    if (typeof raw.id !== "string") return null
    if (typeof raw.label !== "string") return null
    if (typeof raw.savedAt !== "number") return null
    const oauth = parseOauth(raw.oauth)
    if (!oauth) return null
    return {
      id: raw.id,
      label: raw.label,
      savedAt: raw.savedAt,
      email: typeof raw.email === "string" ? raw.email : null,
      accountId: typeof raw.accountId === "string" ? raw.accountId : null,
      oauth,
    }
  }

  async function load() {
    const parsed = await Filesystem.readJson<unknown>(file).catch(() => null)
    const raw = object(parsed)
    if (!raw || raw.version !== 1) return { version: 1, profiles: [] } as Store

    const profiles = Array.isArray(raw.profiles) ? raw.profiles.map(parseProfile).filter((x): x is Profile => !!x) : []
    return {
      version: 1,
      activeProfileId: typeof raw.activeProfileId === "string" ? raw.activeProfileId : undefined,
      profiles,
    } as Store
  }

  async function save(store: Store) {
    await Filesystem.writeJson(file, store, 0o600)
  }

  async function liveOauth() {
    const auth = await Auth.get("openai")
    if (!auth || auth.type !== "oauth") return null
    return auth as OAuth
  }

  function byRefresh(profiles: Profile[], refresh?: string) {
    if (!refresh) return undefined
    return profiles.find((profile) => profile.oauth.refresh === refresh)
  }

  function currentProfile(store: Store, oauth: OAuth | null) {
    if (!oauth) return undefined
    return byRefresh(store.profiles, oauth.refresh)
  }

  function ensure(store: Store, oauth: OAuth | null) {
    if (!oauth) return store
    const match = currentProfile(store, oauth)
    if (match) {
      match.oauth = oauth
      match.email = inferEmail(oauth)
      match.accountId = oauth.accountId ?? null
      return store
    }

    const profile: Profile = {
      id: id(),
      label: defaultLabel(oauth, store.profiles),
      savedAt: Date.now(),
      email: inferEmail(oauth),
      accountId: oauth.accountId ?? null,
      oauth,
    }
    store.profiles.push(profile)
    if (!store.activeProfileId) store.activeProfileId = profile.id
    return store
  }

  function resolve(store: Store, selector: string) {
    const value = selector.trim()
    if (!value) return undefined
    const index = Number(value)
    if (Number.isInteger(index) && index >= 1 && index <= store.profiles.length) return store.profiles[index - 1]

    const lower = value.toLowerCase()
    const exact = store.profiles.find(
      (profile) => profile.id.toLowerCase() === lower || profile.label.toLowerCase() === lower,
    )
    if (exact) return exact

    const fuzzy = store.profiles.filter(
      (profile) =>
        profile.label.toLowerCase().includes(lower) ||
        (profile.email ?? "").toLowerCase().includes(lower) ||
        (profile.accountId ?? "").toLowerCase().includes(lower),
    )
    if (fuzzy.length === 1) return fuzzy[0]
    return undefined
  }

  async function apply(oauth: OAuth) {
    await Auth.set("openai", {
      type: "oauth",
      refresh: oauth.refresh,
      access: oauth.access,
      expires: oauth.expires,
      ...(oauth.accountId ? { accountId: oauth.accountId } : {}),
      ...(oauth.enterpriseUrl ? { enterpriseUrl: oauth.enterpriseUrl } : {}),
    })
  }

  async function result(store: Store, oauth: OAuth | null): Promise<Status> {
    const live = currentProfile(store, oauth)
    const current = oauth
      ? {
          id: live?.id ?? null,
          label: live?.label ?? null,
          email: live?.email ?? inferEmail(oauth),
          accountId: live?.accountId ?? oauth.accountId ?? null,
        }
      : null

    const active = live?.id ?? store.activeProfileId
    if (active && active !== store.activeProfileId) {
      store.activeProfileId = active
      await save(store)
    }

    const usage = await ProviderRateLimit.getOpenAI()

    return {
      current,
      profiles: store.profiles.map((profile) => ({
        id: profile.id,
        label: profile.label,
        email: profile.email,
        accountId: profile.accountId,
        active: profile.id === active,
      })),
      usage,
    }
  }

  export async function status(): Promise<Status> {
    const oauth = await liveOauth()
    const store = ensure(await load(), oauth)
    await save(store)
    return result(store, oauth)
  }

  export async function add(label?: string): Promise<Status> {
    const oauth = await liveOauth()
    if (!oauth) return { current: null, profiles: [], usage: null, error: "No OpenAI OAuth connected" }

    const store = ensure(await load(), oauth)
    let profile = currentProfile(store, oauth)
    if (!profile) {
      profile = {
        id: id(),
        label: defaultLabel(oauth, store.profiles),
        savedAt: Date.now(),
        email: inferEmail(oauth),
        accountId: oauth.accountId ?? null,
        oauth,
      }
      store.profiles.push(profile)
    }

    if (label) profile.label = uniqueLabel(store.profiles, label, profile.id)
    profile.savedAt = Date.now()
    profile.oauth = oauth
    profile.email = inferEmail(oauth)
    profile.accountId = oauth.accountId ?? null
    store.activeProfileId = profile.id
    await save(store)

    return result(store, oauth)
  }

  export async function use(selector: string): Promise<Status> {
    const oauth = await liveOauth()
    const store = ensure(await load(), oauth)
    const profile = resolve(store, selector)
    if (!profile) {
      const fallback = await result(store, oauth)
      return { ...fallback, error: `Profile not found: ${selector}` }
    }

    await apply(profile.oauth)
    store.activeProfileId = profile.id
    await save(store)

    const active = await liveOauth()
    return result(store, active)
  }

  export async function next(): Promise<Status> {
    const oauth = await liveOauth()
    const store = ensure(await load(), oauth)

    if (store.profiles.length < 2) {
      const fallback = await result(store, oauth)
      return { ...fallback, error: "Need at least 2 saved accounts. Run /codexswap add <label> on another login." }
    }

    const current = currentProfile(store, oauth)
    const currentId = current?.id ?? store.activeProfileId ?? store.profiles[0].id
    const index = Math.max(0, store.profiles.findIndex((profile) => profile.id === currentId))
    const target = store.profiles[(index + 1) % store.profiles.length]

    await apply(target.oauth)
    store.activeProfileId = target.id
    await save(store)

    const active = await liveOauth()
    return result(store, active)
  }
}
