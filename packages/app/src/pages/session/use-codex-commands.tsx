import { showToast } from "@opencode-ai/ui/toast"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { useLanguage } from "@/context/language"
import { useGlobalSDK } from "@/context/global-sdk"
import { useGlobalSync } from "@/context/global-sync"
import { usePlatform } from "@/context/platform"
import { useServer } from "@/context/server"
import { DialogConnectProvider } from "@/components/dialog-connect-provider"
import { DialogCodexUsage, type CodexAccount } from "@/components/dialog-codex-usage"
import { parseCodexCommand } from "./codex-command-helpers"

function auth(username?: string, password?: string) {
  if (!password) return
  return `Basic ${btoa(`${username ?? "opencode"}:${password}`)}`
}

export function useCodexCommands() {
  const help =
    "/codexwho\n/codexswap\n/codexswap status\n/codexswap add <label>\n/codexswap add --current <label>\n/codexswap save <label>\n/codexswap use <label|#>"
  const dialog = useDialog()
  const globalSDK = useGlobalSDK()
  const globalSync = useGlobalSync()
  const language = useLanguage()
  const platform = usePlatform()
  const server = useServer()

  const fetcher = platform.fetch ?? globalThis.fetch

  async function request(path: string, init?: RequestInit) {
    const headers = new Headers(init?.headers)
    const authorization = auth(server.current?.http.username, server.current?.http.password)
    if (authorization) headers.set("Authorization", authorization)
    return fetcher(new URL(path, globalSDK.url), {
      ...init,
      headers,
    })
  }

  function show(data: CodexAccount) {
    dialog.show(() => <DialogCodexUsage data={data} />)
  }

  function warn(error: string | undefined) {
    if (!error) return
    showToast({
      title: "Codex",
      description: error,
      variant: "error",
    })
  }

  function name(data: CodexAccount | null) {
    return data?.current?.label ?? data?.current?.email ?? "account"
  }

  async function refresh() {
    await globalSDK.client.global.dispose().catch(() => {})
    await globalSync.bootstrap()
  }

  async function fetchStatus() {
    const response = await request("/provider/openai/account").catch(() => null)
    if (!response?.ok) return null
    return (await response.json()) as CodexAccount
  }

  async function swap(body: { action: "next" | "use" | "add" | "status"; selector?: string; label?: string }) {
    const response = await request("/provider/openai/account/swap", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).catch(() => null)
    if (!response?.ok) return null
    return (await response.json()) as CodexAccount
  }

  async function handleResult(result: CodexAccount | null, failure: string, success?: string) {
    if (!result) {
      showToast({ title: "Codex", description: failure, variant: "error" })
      return
    }
    show(result)
    warn(result.error)
    if (success && !result.error) {
      showToast({ title: "Codex", description: success, variant: "success" })
    }
    await globalSync.bootstrap()
  }

  async function showUsage(input = "/usage") {
    const cmd = parseCodexCommand(input)
    if (!cmd || cmd.kind !== "usage") return false
    if (cmd.providerID !== "openai") {
      showToast({
        title: "Usage",
        description: `Unsupported provider: ${cmd.providerToken ?? "unknown"}`,
        variant: "error",
      })
      return true
    }
    const data = await fetchStatus()
    if (!data) {
      showToast({ title: "Usage", description: "Failed to fetch usage", variant: "error" })
      return true
    }
    show(data)
    warn(data.error)
    return true
  }

  async function showWho() {
    const data = await fetchStatus()
    if (!data) {
      showToast({ title: "Codex", description: "Failed to load account status", variant: "error" })
      return true
    }
    show(data)
    warn(data.error)
    return true
  }

  async function save(label?: string) {
    const result = await swap({ action: "add", ...(label ? { label } : {}) })
    await handleResult(result, "Failed to save current account", `Saved current account as ${name(result)}`)
  }

  async function add(label?: string) {
    const methods = (globalSync.data.provider_auth.openai ?? []).filter((item) => item.type === "oauth")
    if (methods.length === 0) {
      showToast({
        title: "Codex Swap",
        description: "OpenAI OAuth is not available. Connect OpenAI first.",
        variant: "error",
      })
      return
    }
    dialog.show(() => (
      <DialogConnectProvider
        provider="openai"
        methodType="oauth"
        onComplete={async () => {
          await refresh()
          const result = await swap({ action: "add", ...(label ? { label } : {}) })
          await handleResult(result, "Failed to save account", `Added and switched to ${name(result)}`)
        }}
      />
    ))
  }

  async function showSwap(input = "/codexswap") {
    const cmd = parseCodexCommand(input)
    if (!cmd || cmd.kind !== "codexswap") {
      showToast({ title: "Codex Swap", description: help, variant: "error" })
      return true
    }
    if (cmd.action === "status") return showWho()
    if (cmd.action === "add" && cmd.current) {
      await save(cmd.label)
      return true
    }
    if (cmd.action === "add") {
      await add(cmd.label)
      return true
    }

    const body = cmd.action === "use" ? { action: cmd.action, selector: cmd.selector } : { action: cmd.action }
    const result = await swap(body)
    await handleResult(
      result,
      "Failed to switch account",
      cmd.action === "next" || cmd.action === "use" ? `Switched to ${name(result)}` : undefined,
    )
    return true
  }

  async function run(input: string) {
    const cmd = parseCodexCommand(input)
    if (input.trim().startsWith("/usage")) return showUsage(input)
    if (input.trim().startsWith("/codexwho")) return showWho()
    if (input.trim().startsWith("/codexswap")) return showSwap(input)
    if (!cmd) return false
    if (cmd.kind === "usage") return showUsage(input)
    if (cmd.kind === "codexwho") return showWho()
    return showSwap(input)
  }

  return {
    run,
    showUsage,
    showWho,
    showSwap,
    help,
    requestFailed: language.t("common.requestFailed"),
  }
}
