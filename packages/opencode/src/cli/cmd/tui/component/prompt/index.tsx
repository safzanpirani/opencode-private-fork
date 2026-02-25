import { BoxRenderable, TextareaRenderable, MouseEvent, PasteEvent, t, dim, fg } from "@opentui/core"
import { createEffect, createMemo, type JSX, onMount, createSignal, onCleanup, on, Show, Switch, Match, For } from "solid-js"
import "opentui-spinner/solid"
import path from "path"
import { Filesystem } from "@/util/filesystem"
import { useLocal } from "@tui/context/local"
import { useTheme } from "@tui/context/theme"
import { EmptyBorder } from "@tui/component/border"
import { useSDK } from "@tui/context/sdk"
import { useRoute } from "@tui/context/route"
import { useSync } from "@tui/context/sync"
import { Identifier } from "@/id/id"
import { createStore, produce } from "solid-js/store"
import { useKeybind } from "@tui/context/keybind"
import { usePromptHistory, type PromptInfo } from "./history"
import { usePromptStash } from "./stash"
import { DialogStash } from "../dialog-stash"
import { type AutocompleteRef, Autocomplete } from "./autocomplete"
import { useCommandDialog } from "../dialog-command"
import { useRenderer } from "@opentui/solid"
import { Editor } from "@tui/util/editor"
import { useExit } from "../../context/exit"
import { Clipboard } from "../../util/clipboard"
import type { FilePart } from "@opencode-ai/sdk/v2"
import { TuiEvent } from "../../event"
import { iife } from "@/util/iife"
import { Locale } from "@/util/locale"
import { formatDuration } from "@/util/format"
import { createColors, createFrames } from "../../ui/spinner.ts"
import { useDialog } from "@tui/ui/dialog"
import { DialogProvider as DialogProviderConnect } from "../dialog-provider"
import { DialogAlert } from "../../ui/dialog-alert"
import { DialogPrompt } from "../../ui/dialog-prompt"
import { Link } from "../../ui/link"
import { useToast } from "../../ui/toast"
import { useKV } from "../../context/kv"
import { useTextareaKeybindings } from "../textarea-keybindings"
import { DialogSkill } from "../dialog-skill"
import { DialogUsage, type UsageEntry } from "../dialog-usage"

export type PromptProps = {
  sessionID?: string
  visible?: boolean
  disabled?: boolean
  onSubmit?: () => void
  ref?: (ref: PromptRef) => void
  hint?: JSX.Element
  showPlaceholder?: boolean
}

export type PromptRef = {
  focused: boolean
  current: PromptInfo
  set(prompt: PromptInfo): void
  reset(): void
  blur(): void
  focus(): void
  submit(): void
}

const PLACEHOLDERS = ["Fix a TODO in the codebase", "What is the tech stack of this project?", "Fix broken tests"]
const SHELL_PLACEHOLDERS = ["ls -la", "git status", "pwd"]

function DialogCodexSwapOauth(props: { title: string; instructions: string; url: string }) {
  const dialog = useDialog()
  const { theme } = useTheme()

  return (
    <box paddingLeft={2} paddingRight={2} gap={1} paddingBottom={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text fg={theme.text}>
          <b>{props.title}</b>
        </text>
        <text fg={theme.textMuted} onMouseUp={() => dialog.clear()}>
          esc
        </text>
      </box>
      <box gap={1}>
        <Link href={props.url} fg={theme.primary} />
        <text fg={theme.textMuted}>{props.instructions}</text>
      </box>
      <text fg={theme.textMuted}>Waiting for authorization...</text>
    </box>
  )
}

export function Prompt(props: PromptProps) {
  let input: TextareaRenderable
  let anchor: BoxRenderable
  let autocomplete: AutocompleteRef

  const keybind = useKeybind()
  const local = useLocal()
  const sdk = useSDK()
  const route = useRoute()
  const sync = useSync()
  const dialog = useDialog()
  const toast = useToast()
  const status = createMemo(() => sync.data.session_status?.[props.sessionID ?? ""] ?? { type: "idle" })
  const history = usePromptHistory()
  const stash = usePromptStash()
  const command = useCommandDialog()
  const renderer = useRenderer()
  const { theme, syntax } = useTheme()
  const kv = useKV()

  function promptModelWarning() {
    toast.show({
      variant: "warning",
      message: "Connect a provider to send prompts",
      duration: 3000,
    })
    if (sync.data.provider.length === 0) {
      dialog.replace(() => <DialogProviderConnect />)
    }
  }

  function clearPrompt() {
    input.extmarks.clear()
    input.clear()
    setStore("prompt", {
      input: "",
      parts: [],
    })
    setStore("extmarkToPartIndex", new Map())
    props.onSubmit?.()
  }

  function usageProvider(value: string | undefined) {
    if (!value) return "openai"
    const normalized = value.toLowerCase()
    if (["openai", "codex", "chatgpt", "gpt"].includes(normalized)) return "openai"
    return ""
  }

  type AccountResponse = {
    current: {
      id: string | null
      label: string | null
      email: string | null
      accountId: string | null
    } | null
    profiles: {
      id: string
      label: string
      email: string | null
      accountId: string | null
      active: boolean
    }[]
    usage: {
      limitId: string | null
      limitName: string | null
      primary: {
        usedPercent: number
        windowDurationMins: number | null
        resetsAt: number | null
      } | null
      secondary: {
        usedPercent: number
        windowDurationMins: number | null
        resetsAt: number | null
      } | null
      planType: string | null
    } | null
    error?: string
  }

  function toUsageEntry(input: AccountResponse): UsageEntry[] {
    if (!input.usage) return []
    return [
      {
        provider: "openai",
        displayName: "OpenAI",
        planType: input.usage.planType,
        primary: input.usage.primary
          ? {
              usedPercent: input.usage.primary.usedPercent,
              windowMinutes: input.usage.primary.windowDurationMins,
              resetsAt: input.usage.primary.resetsAt,
            }
          : null,
        secondary: input.usage.secondary
          ? {
              usedPercent: input.usage.secondary.usedPercent,
              windowMinutes: input.usage.secondary.windowDurationMins,
              resetsAt: input.usage.secondary.resetsAt,
            }
          : null,
      },
    ]
  }

  function showUsageDialog(data: AccountResponse) {
    dialog.replace(() => <DialogUsage entries={toUsageEntry(data)} account={data.current} profiles={data.profiles} />)
  }

  async function fetchAccountStatus(): Promise<AccountResponse | null> {
    return sdk.fetch(`${sdk.url}/provider/openai/account`)
      .then((response) => {
        if (!response.ok) return null
        return response.json()
      })
      .then((data) => (data ?? null) as AccountResponse | null)
      .catch(() => null)
  }

  function showUsage(inputText: string) {
    const parts = inputText.trim().split(/\s+/)
    const providerToken = parts.slice(1).find((part) => !part.startsWith("-"))
    const providerID = usageProvider(providerToken)
    if (providerID !== "openai") {
      DialogAlert.show(dialog, "Usage", `Unsupported provider: ${providerToken ?? "unknown"}`)
      return
    }

    void fetchAccountStatus().then((data) => {
      if (!data) {
        DialogAlert.show(dialog, "Usage", "Failed to fetch usage")
        return
      }
      showUsageDialog(data)
      if (data.error) {
        toast.show({
          variant: "warning",
          message: data.error,
          duration: 3000,
        })
      }
    })
  }

  function showCodexWho() {
    void fetchAccountStatus().then((data) => {
      if (!data) {
        DialogAlert.show(dialog, "Codex", "Failed to load account status")
        return
      }
      showUsageDialog(data)
      if (data.error) {
        toast.show({
          variant: "warning",
          message: data.error,
          duration: 3000,
        })
      }
    })
  }

  async function runCodexSwapRequest(body: {
    action: "next" | "use" | "add" | "status"
    selector?: string
    label?: string
  }): Promise<AccountResponse | null> {
    const response = await sdk
      .fetch(`${sdk.url}/provider/openai/account/swap`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      .catch(() => null)
    if (!response?.ok) return null
    return (await response.json()) as AccountResponse
  }

  async function completeCodexAdd(label?: string) {
    const providerMethods = sync.data.provider_auth.openai?.length
      ? sync.data.provider_auth.openai
      : await sdk.client.provider.auth().then((result) => result.data?.openai ?? []).catch(() => [])

    const oauthMethods = providerMethods
      .map((method, index) => ({ method, index }))
      .filter((item) => item.method.type === "oauth")

    if (oauthMethods.length === 0) {
      DialogAlert.show(dialog, "Codex Swap", "OpenAI OAuth is not available. Use /connect first.")
      return
    }

    const picked =
      oauthMethods.find((item) => /chatgpt/i.test(item.method.label) && /browser/i.test(item.method.label)) ??
      oauthMethods.find((item) => /browser/i.test(item.method.label)) ??
      oauthMethods[0]

    const auth = await sdk.client.provider.oauth.authorize({
      providerID: "openai",
      method: picked.index,
    })
    const authorization = auth.data
    if (!authorization) {
      DialogAlert.show(dialog, "Codex Swap", "Failed to start OpenAI OAuth")
      return
    }

    if (authorization.method === "auto") {
      dialog.replace(
        () => (
          <DialogCodexSwapOauth
            title={picked.method.label}
            instructions={authorization.instructions}
            url={authorization.url}
          />
        ),
      )
      const callback = await sdk.client.provider.oauth.callback({
        providerID: "openai",
        method: picked.index,
      })
      if (callback.error) {
        dialog.clear()
        DialogAlert.show(dialog, "Codex Swap", "OAuth authorization failed")
        return
      }
    }

    if (authorization.method === "code") {
      const code = await DialogPrompt.show(dialog, picked.method.label, {
        placeholder: "Authorization code",
        description: () => (
          <box gap={1}>
            <text fg={theme.textMuted}>{authorization.instructions}</text>
            <Link href={authorization.url} fg={theme.primary} />
          </box>
        ),
      })
      if (!code) return

      const callback = await sdk.client.provider.oauth.callback({
        providerID: "openai",
        method: picked.index,
        code,
      })
      if (callback.error) {
        DialogAlert.show(dialog, "Codex Swap", "OAuth authorization failed")
        return
      }
    }

    await sdk.client.instance.dispose().catch(() => {})
    await sync.bootstrap()

    const result = await runCodexSwapRequest({
      action: "add",
      ...(label ? { label } : {}),
    })
    if (!result) {
      DialogAlert.show(dialog, "Codex Swap", "Failed to save account")
      return
    }

    showUsageDialog(result)
    if (result.error) {
      toast.show({ variant: "warning", message: result.error, duration: 3000 })
    } else {
      const name = result.current?.label ?? result.current?.email ?? "account"
      toast.show({ variant: "success", message: `Added and switched to ${name}`, duration: 2200 })
    }
    await sync.bootstrap()
  }

  async function saveCurrentCodexProfile(label?: string) {
    const result = await runCodexSwapRequest({
      action: "add",
      ...(label ? { label } : {}),
    })
    if (!result) {
      DialogAlert.show(dialog, "Codex Swap", "Failed to save current account")
      return
    }

    showUsageDialog(result)
    if (result.error) {
      toast.show({ variant: "warning", message: result.error, duration: 3000 })
    } else {
      const name = result.current?.label ?? result.current?.email ?? "account"
      toast.show({ variant: "success", message: `Saved current account as ${name}`, duration: 2200 })
    }
    await sync.bootstrap()
  }

  function showCodexSwap(inputText: string) {
    const parts = inputText.trim().split(/\s+/)
    const sub = (parts[1] ?? "next").toLowerCase()

    if (sub === "status" || sub === "list" || sub === "who") {
      showCodexWho()
      return
    }

    if (sub === "save" || sub === "save-current") {
      const label = parts.slice(2).join(" ").trim() || undefined
      void saveCurrentCodexProfile(label)
      return
    }

    if (sub === "add") {
      const currentFlag = parts[2] === "--current" || parts[2] === "-c"
      if (currentFlag) {
        const label = parts.slice(3).join(" ").trim() || undefined
        void saveCurrentCodexProfile(label)
        return
      }

      const label = parts.slice(2).join(" ").trim() || undefined
      void completeCodexAdd(label)
      return
    }

    const body = (() => {
      if (sub === "next") return { action: "next" as const }
      if (sub === "use") return { action: "use" as const, selector: parts.slice(2).join(" ").trim() || undefined }
      if (parts.length === 1) return { action: "next" as const }
      return null
    })()

    if (!body) {
      DialogAlert.show(
        dialog,
        "Codex Swap",
        "Usage:\n/codexwho\n/codexswap\n/codexswap status\n/codexswap add <label>\n/codexswap add --current <label>\n/codexswap save <label>\n/codexswap use <label|#>",
      )
      return
    }

    void runCodexSwapRequest(body)
      .then((result) => {
        if (!result) {
          DialogAlert.show(dialog, "Codex Swap", "Failed to switch account")
          return
        }
        showUsageDialog(result)
        if (result.error) {
          toast.show({ variant: "warning", message: result.error, duration: 3000 })
        } else {
          const label = result.current?.label ?? result.current?.email ?? "account"
          toast.show({ variant: "success", message: `Switched to ${label}`, duration: 2000 })
        }
        void sync.bootstrap()
      })
      .catch(() => {
        DialogAlert.show(dialog, "Codex Swap", "Failed to switch account")
      })
  }

  const textareaKeybindings = useTextareaKeybindings()

  const fileStyleId = syntax().getStyleId("extmark.file")!
  const agentStyleId = syntax().getStyleId("extmark.agent")!
  const pasteStyleId = syntax().getStyleId("extmark.paste")!
  let promptPartTypeId = 0

  sdk.event.on(TuiEvent.PromptAppend.type, (evt) => {
    if (!input || input.isDestroyed) return
    input.insertText(evt.properties.text)
    setTimeout(() => {
      // setTimeout is a workaround and needs to be addressed properly
      if (!input || input.isDestroyed) return
      input.getLayoutNode().markDirty()
      input.gotoBufferEnd()
      renderer.requestRender()
    }, 0)
  })

  createEffect(() => {
    if (props.disabled) input.cursorColor = theme.backgroundElement
    if (!props.disabled) input.cursorColor = theme.text
  })

  const lastUserMessage = createMemo(() => {
    if (!props.sessionID) return undefined
    const messages = sync.data.message[props.sessionID]
    if (!messages) return undefined
    return messages.findLast((m) => m.role === "user")
  })

  const [store, setStore] = createStore<{
    prompt: PromptInfo
    mode: "normal" | "shell"
    extmarkToPartIndex: Map<number, number>
    interrupt: number
    placeholder: number
  }>({
    placeholder: Math.floor(Math.random() * PLACEHOLDERS.length),
    prompt: {
      input: "",
      parts: [],
    },
    mode: "normal",
    extmarkToPartIndex: new Map(),
    interrupt: 0,
  })

  type QueuedPrompt = {
    id: string
    sessionID: string
    inputText: string
    parts: PromptInfo["parts"]
    agent: string
    model: { providerID: string; modelID: string }
    variant?: string
  }

  const [queuedPrompts, setQueuedPrompts] = createSignal<QueuedPrompt[]>([])
  const [sendingQueuedPrompt, setSendingQueuedPrompt] = createSignal(false)
  const [queuedEditID, setQueuedEditID] = createSignal<string>()
  const [queuedCursor, setQueuedCursor] = createSignal<number>()
  const [queueGate, setQueueGate] = createSignal<"open" | "paused" | "wait_busy" | "wait_idle">("open")

  const queuedPromptsForSession = createMemo(() => {
    const sessionID = props.sessionID
    if (!sessionID) return []
    return queuedPrompts().filter((item) => item.sessionID === sessionID)
  })
  const queuedPromptsForSessionNewest = createMemo(() => queuedPromptsForSession().slice().reverse())
  const editingQueuedPrompt = createMemo(() => {
    const id = queuedEditID()
    if (!id) return
    return queuedPromptsForSession().find((item) => item.id === id)
  })

  createEffect(
    on(
      () => props.sessionID,
      () => {
        setStore("placeholder", Math.floor(Math.random() * PLACEHOLDERS.length))
        setQueueGate("open")
      },
      { defer: true },
    ),
  )

  // Initialize agent/model/variant from last user message when session changes
  let syncedSessionID: string | undefined
  createEffect(() => {
    const sessionID = props.sessionID
    const msg = lastUserMessage()

    if (sessionID !== syncedSessionID) {
      if (!sessionID || !msg) return

      syncedSessionID = sessionID

      // Only set agent if it's a primary agent (not a subagent)
      const isPrimaryAgent = local.agent.list().some((x) => x.name === msg.agent)
      if (msg.agent && isPrimaryAgent) {
        local.agent.set(msg.agent)
        if (msg.model) local.model.set(msg.model)
        if (msg.variant) local.model.variant.set(msg.variant)
      }
    }
  })

  command.register(() => {
    return [
      {
        title: "Clear prompt",
        value: "prompt.clear",
        category: "Prompt",
        hidden: true,
        onSelect: (dialog) => {
          input.extmarks.clear()
          input.clear()
          dialog.clear()
        },
      },
      {
        title: "Submit prompt",
        value: "prompt.submit",
        keybind: "input_submit",
        category: "Prompt",
        hidden: true,
        onSelect: (dialog) => {
          if (!input.focused) return
          submit()
          dialog.clear()
        },
      },
      {
        title: "Paste",
        value: "prompt.paste",
        keybind: "input_paste",
        category: "Prompt",
        hidden: true,
        onSelect: async () => {
          const content = await Clipboard.read()
          if (content?.mime.startsWith("image/")) {
            await pasteImage({
              filename: "clipboard",
              mime: content.mime,
              content: content.data,
            })
          }
        },
      },
      {
        title: "Interrupt session",
        value: "session.interrupt",
        keybind: "session_interrupt",
        category: "Session",
        hidden: true,
        enabled: status().type !== "idle",
        onSelect: (dialog) => {
          if (autocomplete.visible) return
          if (!input.focused) return
          // TODO: this should be its own command
          if (store.mode === "shell") {
            setStore("mode", "normal")
            return
          }
          if (!props.sessionID) return

          setStore("interrupt", store.interrupt + 1)

          setTimeout(() => {
            setStore("interrupt", 0)
          }, 5000)

          if (store.interrupt >= 2) {
            sdk.client.session.abort({
              sessionID: props.sessionID,
            })
            setQueueGate("paused")
            setStore("interrupt", 0)
          }
          dialog.clear()
        },
      },
      {
        title: "Open editor",
        category: "Session",
        keybind: "editor_open",
        value: "prompt.editor",
        slash: {
          name: "editor",
        },
        onSelect: async (dialog) => {
          dialog.clear()

          // replace summarized text parts with the actual text
          const text = store.prompt.parts
            .filter((p) => p.type === "text")
            .reduce((acc, p) => {
              if (!p.source) return acc
              return acc.replace(p.source.text.value, p.text)
            }, store.prompt.input)

          const nonTextParts = store.prompt.parts.filter((p) => p.type !== "text")

          const value = text
          const content = await Editor.open({ value, renderer })
          if (!content) return

          input.setText(content)

          // Update positions for nonTextParts based on their location in new content
          // Filter out parts whose virtual text was deleted
          // this handles a case where the user edits the text in the editor
          // such that the virtual text moves around or is deleted
          const updatedNonTextParts = nonTextParts
            .map((part) => {
              let virtualText = ""
              if (part.type === "file" && part.source?.text) {
                virtualText = part.source.text.value
              } else if (part.type === "agent" && part.source) {
                virtualText = part.source.value
              }

              if (!virtualText) return part

              const newStart = content.indexOf(virtualText)
              // if the virtual text is deleted, remove the part
              if (newStart === -1) return null

              const newEnd = newStart + virtualText.length

              if (part.type === "file" && part.source?.text) {
                return {
                  ...part,
                  source: {
                    ...part.source,
                    text: {
                      ...part.source.text,
                      start: newStart,
                      end: newEnd,
                    },
                  },
                }
              }

              if (part.type === "agent" && part.source) {
                return {
                  ...part,
                  source: {
                    ...part.source,
                    start: newStart,
                    end: newEnd,
                  },
                }
              }

              return part
            })
            .filter((part) => part !== null)

          setStore("prompt", {
            input: content,
            // keep only the non-text parts because the text parts were
            // already expanded inline
            parts: updatedNonTextParts,
          })
          restoreExtmarksFromParts(updatedNonTextParts)
          input.cursorOffset = Bun.stringWidth(content)
        },
      },
      {
        title: "Skills",
        value: "prompt.skills",
        category: "Prompt",
        slash: {
          name: "skills",
        },
        onSelect: () => {
          dialog.replace(() => (
            <DialogSkill
              onSelect={(skill) => {
                input.setText(`/${skill} `)
                setStore("prompt", {
                  input: `/${skill} `,
                  parts: [],
                })
                input.gotoBufferEnd()
              }}
            />
          ))
        },
      },
      {
        title: "Usage",
        value: "prompt.usage",
        category: "Prompt",
        slash: {
          name: "usage",
        },
        onSelect: (dialog) => {
          showUsage("/usage")
          dialog.clear()
        },
      },
      {
        title: "Codex Who",
        value: "prompt.codexwho",
        category: "Prompt",
        slash: {
          name: "codexwho",
        },
        onSelect: (dialog) => {
          showCodexWho()
          dialog.clear()
        },
      },
      {
        title: "Codex Swap",
        value: "prompt.codexswap",
        category: "Prompt",
        slash: {
          name: "codexswap",
        },
        onSelect: (dialog) => {
          showCodexSwap("/codexswap")
          dialog.clear()
        },
      },
    ]
  })

  const ref: PromptRef = {
    get focused() {
      return input.focused
    },
    get current() {
      return store.prompt
    },
    focus() {
      input.focus()
    },
    blur() {
      input.blur()
    },
    set(prompt) {
      input.setText(prompt.input)
      setStore("prompt", prompt)
      restoreExtmarksFromParts(prompt.parts)
      input.gotoBufferEnd()
    },
    reset() {
      input.clear()
      input.extmarks.clear()
      setStore("prompt", {
        input: "",
        parts: [],
      })
      setStore("extmarkToPartIndex", new Map())
    },
    submit() {
      submit()
    },
  }

  createEffect(() => {
    if (props.visible !== false) input?.focus()
    if (props.visible === false) input?.blur()
  })

  function restoreExtmarksFromParts(parts: PromptInfo["parts"]) {
    input.extmarks.clear()
    setStore("extmarkToPartIndex", new Map())

    parts.forEach((part, partIndex) => {
      let start = 0
      let end = 0
      let virtualText = ""
      let styleId: number | undefined

      if (part.type === "file" && part.source?.text) {
        start = part.source.text.start
        end = part.source.text.end
        virtualText = part.source.text.value
        styleId = fileStyleId
      } else if (part.type === "agent" && part.source) {
        start = part.source.start
        end = part.source.end
        virtualText = part.source.value
        styleId = agentStyleId
      } else if (part.type === "text" && part.source?.text) {
        start = part.source.text.start
        end = part.source.text.end
        virtualText = part.source.text.value
        styleId = pasteStyleId
      }

      if (virtualText) {
        const extmarkId = input.extmarks.create({
          start,
          end,
          virtual: true,
          styleId,
          typeId: promptPartTypeId,
        })
        setStore("extmarkToPartIndex", (map: Map<number, number>) => {
          const newMap = new Map(map)
          newMap.set(extmarkId, partIndex)
          return newMap
        })
      }
    })
  }

  function syncExtmarksWithPromptParts() {
    const allExtmarks = input.extmarks.getAllForTypeId(promptPartTypeId)
    setStore(
      produce((draft) => {
        const newMap = new Map<number, number>()
        const newParts: typeof draft.prompt.parts = []

        for (const extmark of allExtmarks) {
          const partIndex = draft.extmarkToPartIndex.get(extmark.id)
          if (partIndex !== undefined) {
            const part = draft.prompt.parts[partIndex]
            if (part) {
              if (part.type === "agent" && part.source) {
                part.source.start = extmark.start
                part.source.end = extmark.end
              } else if (part.type === "file" && part.source?.text) {
                part.source.text.start = extmark.start
                part.source.text.end = extmark.end
              } else if (part.type === "text" && part.source?.text) {
                part.source.text.start = extmark.start
                part.source.text.end = extmark.end
              }
              newMap.set(extmark.id, newParts.length)
              newParts.push(part)
            }
          }
        }

        draft.extmarkToPartIndex = newMap
        draft.prompt.parts = newParts
      }),
    )
  }

  command.register(() => [
    {
      title: "Stash prompt",
      value: "prompt.stash",
      category: "Prompt",
      enabled: !!store.prompt.input,
      onSelect: (dialog) => {
        if (!store.prompt.input) return
        stash.push({
          input: store.prompt.input,
          parts: store.prompt.parts,
        })
        input.extmarks.clear()
        input.clear()
        setStore("prompt", { input: "", parts: [] })
        setStore("extmarkToPartIndex", new Map())
        dialog.clear()
      },
    },
    {
      title: "Stash pop",
      value: "prompt.stash.pop",
      category: "Prompt",
      enabled: stash.list().length > 0,
      onSelect: (dialog) => {
        const entry = stash.pop()
        if (entry) {
          input.setText(entry.input)
          setStore("prompt", { input: entry.input, parts: entry.parts })
          restoreExtmarksFromParts(entry.parts)
          input.gotoBufferEnd()
        }
        dialog.clear()
      },
    },
    {
      title: "Stash list",
      value: "prompt.stash.list",
      category: "Prompt",
      enabled: stash.list().length > 0,
      onSelect: (dialog) => {
        dialog.replace(() => (
          <DialogStash
            onSelect={(entry) => {
              input.setText(entry.input)
              setStore("prompt", { input: entry.input, parts: entry.parts })
              restoreExtmarksFromParts(entry.parts)
              input.gotoBufferEnd()
            }}
          />
        ))
      },
    },
  ])

  function resolvePromptInput() {
    let inputText = store.prompt.input
    const allExtmarks = input.extmarks.getAllForTypeId(promptPartTypeId)
    const sortedExtmarks = allExtmarks.sort((a: { start: number }, b: { start: number }) => b.start - a.start)

    for (const extmark of sortedExtmarks) {
      const partIndex = store.extmarkToPartIndex.get(extmark.id)
      if (partIndex !== undefined) {
        const part = store.prompt.parts[partIndex]
        if (part?.type === "text" && part.text) {
          const before = inputText.slice(0, extmark.start)
          const after = inputText.slice(extmark.end)
          inputText = before + part.text + after
        }
      }
    }

    return {
      inputText,
      nonTextParts: store.prompt.parts.filter((part) => part.type !== "text"),
    }
  }

  function sendPrompt(input: {
    sessionID: string
    model: { providerID: string; modelID: string }
    variant?: string
    agent: string
    inputText: string
    parts: PromptInfo["parts"]
    messageID?: string
  }) {
    return sdk.client.session.prompt({
      sessionID: input.sessionID,
      ...input.model,
      messageID: input.messageID ?? Identifier.ascending("message"),
      agent: input.agent,
      model: input.model,
      variant: input.variant,
      parts: [
        {
          id: Identifier.ascending("part"),
          type: "text",
          text: input.inputText,
        },
        ...input.parts.map((x) => ({
          id: Identifier.ascending("part"),
          ...x,
        })),
      ],
    })
  }

  function editQueued(direction: -1 | 1) {
    if (props.disabled) return
    if (!props.sessionID) return
    if (store.mode !== "normal") return

    const list = queuedPromptsForSessionNewest()
    if (list.length === 0) return

    const current = queuedCursor()
    const next = (() => {
      if (current === undefined) return direction === -1 ? 0 : list.length - 1
      const index = current + direction
      if (index < 0) return list.length - 1
      if (index >= list.length) return 0
      return index
    })()

    const target = list[next]
    if (!target) return

    setQueuedCursor(next)
    setQueuedEditID(target.id)
    input.setText(target.inputText)
    setStore("prompt", {
      input: target.inputText,
      parts: target.parts,
    })
    restoreExtmarksFromParts(target.parts)
    input.gotoBufferEnd()
  }

  function queueAtEndOfLoop() {
    if (props.disabled) return
    if (autocomplete?.visible) return
    if (!props.sessionID || status().type === "idle" || store.mode !== "normal") {
      void submit()
      return
    }

    const trimmed = store.prompt.input.trim()
    if (!trimmed || trimmed.startsWith("/")) {
      void submit()
      return
    }

    const selectedModel = local.model.current()
    if (!selectedModel) {
      promptModelWarning()
      return
    }

    const payload = resolvePromptInput()
    const queued = queuedPromptsForSession().length + 1
    setQueuedPrompts((list) => [
      ...list,
      {
        id: Identifier.ascending("part"),
        sessionID: props.sessionID!,
        inputText: payload.inputText,
        parts: payload.nonTextParts,
        agent: local.agent.current().name,
        model: {
          providerID: selectedModel.providerID,
          modelID: selectedModel.modelID,
        },
        variant: local.model.variant.current(),
      },
    ])

    setQueuedCursor(undefined)
    setQueuedEditID(undefined)
    history.append({
      ...store.prompt,
      mode: store.mode,
    })
    clearPrompt()
    toast.show({
      variant: "info",
      message: `Queued for end of loop (${queued})`,
      duration: 2000,
    })
  }

  createEffect(() => {
    const current = queuedEditID()
    if (!current) return
    if (queuedPromptsForSession().some((item) => item.id === current)) return
    setQueuedEditID(undefined)
    setQueuedCursor(undefined)
  })

  createEffect(() => {
    const gate = queueGate()
    if (gate === "open" || gate === "paused") return
    const current = status().type
    if (gate === "wait_busy") {
      if (current === "idle") return
      setQueueGate("wait_idle")
      return
    }
    if (current !== "idle") return
    setQueueGate("open")
  })

  createEffect(() => {
    if (queueGate() !== "open") return
    if (sendingQueuedPrompt()) return
    if (queuedEditID()) return
    if (status().type !== "idle") return
    const next = queuedPromptsForSession()[0]
    if (!next) return

    setSendingQueuedPrompt(true)
    setQueuedPrompts((list) => {
      const index = list.findIndex((item) => item.id === next.id)
      if (index < 0) return list
      return [...list.slice(0, index), ...list.slice(index + 1)]
    })
    sendPrompt({
      sessionID: next.sessionID,
      model: next.model,
      variant: next.variant,
      agent: next.agent,
      inputText: next.inputText,
      parts: next.parts,
    })
      .catch(() => {
        toast.show({
          variant: "error",
          message: "Failed to send queued prompt",
          duration: 3000,
        })
      })
      .finally(() => {
        setSendingQueuedPrompt(false)
      })
  })

  function queuedPreview(inputText: string) {
    const oneLine = inputText.replace(/\s+/g, " ").trim()
    if (oneLine.length <= 80) return oneLine
    return oneLine.slice(0, 77) + "..."
  }

  async function submit() {
    if (props.disabled) return
    const trimmed = store.prompt.input.trim()
    if (
      autocomplete?.visible &&
      !trimmed.startsWith("/usage") &&
      !trimmed.startsWith("/codexwho") &&
      !trimmed.startsWith("/codexswap")
    )
      return
    if (!store.prompt.input) return
    if (trimmed === "exit" || trimmed === "quit" || trimmed === ":q") {
      exit()
      return
    }
    if (trimmed.startsWith("/usage")) {
      showUsage(trimmed)
      clearPrompt()
      return
    }
    if (trimmed.startsWith("/codexwho")) {
      showCodexWho()
      clearPrompt()
      return
    }
    if (trimmed.startsWith("/codexswap")) {
      showCodexSwap(trimmed)
      clearPrompt()
      return
    }

    const payload = resolvePromptInput()
    const inputText = payload.inputText
    const nonTextParts = payload.nonTextParts

    const queuedEditing = editingQueuedPrompt()
    if (queuedEditing) {
      setQueuedPrompts((list) =>
        list.map((item) =>
          item.id === queuedEditing.id
            ? {
                ...item,
                inputText,
                parts: nonTextParts,
              }
            : item,
        ),
      )
      history.append({
        ...store.prompt,
        mode: store.mode,
      })
      setQueuedCursor(undefined)
      setQueuedEditID(undefined)
      clearPrompt()
      toast.show({
        variant: "success",
        message: "Queued message updated",
        duration: 1500,
      })
      return
    }

    const selectedModel = local.model.current()
    if (!selectedModel) {
      promptModelWarning()
      return
    }
    const sessionID = props.sessionID
      ? props.sessionID
      : await (async () => {
          const sessionID = await sdk.client.session.create({}).then((x) => x.data!.id)
          return sessionID
        })()
    const messageID = Identifier.ascending("message")
    if (queueGate() === "paused") setQueueGate("wait_busy")

    // Capture mode before it gets reset
    const currentMode = store.mode
    const variant = local.model.variant.current()

    if (store.mode === "shell") {
      sdk.client.session.shell({
        sessionID,
        agent: local.agent.current().name,
        model: {
          providerID: selectedModel.providerID,
          modelID: selectedModel.modelID,
        },
        command: inputText,
      })
      setStore("mode", "normal")
    } else if (
      inputText.startsWith("/") &&
      iife(() => {
        const firstLine = inputText.split("\n")[0]
        const command = firstLine.split(" ")[0].slice(1)
        return sync.data.command.some((x) => x.name === command)
      })
    ) {
      // Parse command from first line, preserve multi-line content in arguments
      const firstLineEnd = inputText.indexOf("\n")
      const firstLine = firstLineEnd === -1 ? inputText : inputText.slice(0, firstLineEnd)
      const [command, ...firstLineArgs] = firstLine.split(" ")
      const restOfInput = firstLineEnd === -1 ? "" : inputText.slice(firstLineEnd + 1)
      const args = firstLineArgs.join(" ") + (restOfInput ? "\n" + restOfInput : "")

      sdk.client.session.command({
        sessionID,
        command: command.slice(1),
        arguments: args,
        agent: local.agent.current().name,
        model: `${selectedModel.providerID}/${selectedModel.modelID}`,
        messageID,
        variant,
        parts: nonTextParts
          .filter((x) => x.type === "file")
          .map((x) => ({
            id: Identifier.ascending("part"),
            ...x,
          })),
      })
    } else {
      sendPrompt({
        sessionID,
        model: selectedModel,
        messageID,
        agent: local.agent.current().name,
        variant,
        inputText,
        parts: nonTextParts,
      }).catch(() => {})
    }
    history.append({
      ...store.prompt,
      mode: currentMode,
    })
    input.extmarks.clear()
    setStore("prompt", {
      input: "",
      parts: [],
    })
    setStore("extmarkToPartIndex", new Map())
    props.onSubmit?.()

    // temporary hack to make sure the message is sent
    if (!props.sessionID)
      setTimeout(() => {
        route.navigate({
          type: "session",
          sessionID,
        })
      }, 50)
    input.clear()
  }
  const exit = useExit()

  function pasteText(text: string, virtualText: string) {
    const currentOffset = input.visualCursor.offset
    const extmarkStart = currentOffset
    const extmarkEnd = extmarkStart + virtualText.length

    input.insertText(virtualText + " ")

    const extmarkId = input.extmarks.create({
      start: extmarkStart,
      end: extmarkEnd,
      virtual: true,
      styleId: pasteStyleId,
      typeId: promptPartTypeId,
    })

    setStore(
      produce((draft) => {
        const partIndex = draft.prompt.parts.length
        draft.prompt.parts.push({
          type: "text" as const,
          text,
          source: {
            text: {
              start: extmarkStart,
              end: extmarkEnd,
              value: virtualText,
            },
          },
        })
        draft.extmarkToPartIndex.set(extmarkId, partIndex)
      }),
    )
  }

  async function pasteImage(file: { filename?: string; content: string; mime: string }) {
    const currentOffset = input.visualCursor.offset
    const extmarkStart = currentOffset
    const count = store.prompt.parts.filter((x) => x.type === "file" && x.mime.startsWith("image/")).length
    const virtualText = `[Image ${count + 1}]`
    const extmarkEnd = extmarkStart + virtualText.length
    const textToInsert = virtualText + " "

    input.insertText(textToInsert)

    const extmarkId = input.extmarks.create({
      start: extmarkStart,
      end: extmarkEnd,
      virtual: true,
      styleId: pasteStyleId,
      typeId: promptPartTypeId,
    })

    const part: Omit<FilePart, "id" | "messageID" | "sessionID"> = {
      type: "file" as const,
      mime: file.mime,
      filename: file.filename,
      url: `data:${file.mime};base64,${file.content}`,
      source: {
        type: "file",
        path: file.filename ?? "",
        text: {
          start: extmarkStart,
          end: extmarkEnd,
          value: virtualText,
        },
      },
    }
    setStore(
      produce((draft) => {
        const partIndex = draft.prompt.parts.length
        draft.prompt.parts.push(part)
        draft.extmarkToPartIndex.set(extmarkId, partIndex)
      }),
    )
    return
  }

  const highlight = createMemo(() => {
    if (keybind.leader) return theme.border
    if (store.mode === "shell") return theme.primary
    return local.agent.color(local.agent.current().name)
  })

  const showVariant = createMemo(() => {
    const variants = local.model.variant.list()
    if (variants.length === 0) return false
    const current = local.model.variant.current()
    return !!current
  })

  const placeholderText = createMemo(() => {
    if (props.sessionID) return undefined
    if (store.mode === "shell") {
      const example = SHELL_PLACEHOLDERS[store.placeholder % SHELL_PLACEHOLDERS.length]
      return `Run a command... "${example}"`
    }
    return `Ask anything... "${PLACEHOLDERS[store.placeholder % PLACEHOLDERS.length]}"`
  })

  const spinnerDef = createMemo(() => {
    const color = local.agent.color(local.agent.current().name)
    return {
      frames: createFrames({
        color,
        style: "blocks",
        inactiveFactor: 0.6,
        // enableFading: false,
        minAlpha: 0.3,
      }),
      color: createColors({
        color,
        style: "blocks",
        inactiveFactor: 0.6,
        // enableFading: false,
        minAlpha: 0.3,
      }),
    }
  })

  return (
    <>
      <Autocomplete
        sessionID={props.sessionID}
        ref={(r) => (autocomplete = r)}
        anchor={() => anchor}
        input={() => input}
        setPrompt={(cb) => {
          setStore("prompt", produce(cb))
        }}
        setExtmark={(partIndex, extmarkId) => {
          setStore("extmarkToPartIndex", (map: Map<number, number>) => {
            const newMap = new Map(map)
            newMap.set(extmarkId, partIndex)
            return newMap
          })
        }}
        value={store.prompt.input}
        fileStyleId={fileStyleId}
        agentStyleId={agentStyleId}
        promptPartTypeId={() => promptPartTypeId}
      />
      <box ref={(r) => (anchor = r)} visible={props.visible !== false}>
        <box
          border={["left"]}
          borderColor={highlight()}
          customBorderChars={{
            ...EmptyBorder,
            vertical: "┃",
            bottomLeft: "╹",
          }}
        >
          <box
            paddingLeft={2}
            paddingRight={2}
            paddingTop={1}
            flexShrink={0}
            backgroundColor={theme.backgroundElement}
            flexGrow={1}
          >
            <textarea
              placeholder={placeholderText()}
              textColor={keybind.leader ? theme.textMuted : theme.text}
              focusedTextColor={keybind.leader ? theme.textMuted : theme.text}
              minHeight={1}
              maxHeight={6}
              onContentChange={() => {
                const value = input.plainText
                setStore("prompt", "input", value)
                autocomplete.onInput(value)
                syncExtmarksWithPromptParts()
              }}
              keyBindings={textareaKeybindings()}
              onKeyDown={async (e) => {
                if (props.disabled) {
                  e.preventDefault()
                  return
                }

                if (e.name === "return" && e.meta) {
                  e.preventDefault()
                  queueAtEndOfLoop()
                  return
                }

                if (e.name === "up" && e.meta) {
                  e.preventDefault()
                  editQueued(-1)
                  return
                }

                if (e.name === "down" && e.meta) {
                  e.preventDefault()
                  editQueued(1)
                  return
                }

                // Handle clipboard paste (Ctrl+V) - check for images first on Windows
                // This is needed because Windows terminal doesn't properly send image data
                // through bracketed paste, so we need to intercept the keypress and
                // directly read from clipboard before the terminal handles it
                if (keybind.match("input_paste", e)) {
                  const content = await Clipboard.read()
                  if (content?.mime.startsWith("image/")) {
                    e.preventDefault()
                    await pasteImage({
                      filename: "clipboard",
                      mime: content.mime,
                      content: content.data,
                    })
                    return
                  }
                  // If no image, let the default paste behavior continue
                }
                if (keybind.match("input_clear", e) && store.prompt.input !== "") {
                  input.clear()
                  input.extmarks.clear()
                  setStore("prompt", {
                    input: "",
                    parts: [],
                  })
                  setStore("extmarkToPartIndex", new Map())
                  return
                }
                if (keybind.match("app_exit", e)) {
                  if (store.prompt.input === "") {
                    await exit()
                    // Don't preventDefault - let textarea potentially handle the event
                    e.preventDefault()
                    return
                  }
                }
                if (e.name === "!" && input.visualCursor.offset === 0) {
                  setStore("placeholder", Math.floor(Math.random() * SHELL_PLACEHOLDERS.length))
                  setStore("mode", "shell")
                  e.preventDefault()
                  return
                }
                if (store.mode === "shell") {
                  if ((e.name === "backspace" && input.visualCursor.offset === 0) || e.name === "escape") {
                    setStore("mode", "normal")
                    e.preventDefault()
                    return
                  }
                }
                if (store.mode === "normal") autocomplete.onKeyDown(e)
                if (!autocomplete.visible) {
                  if (
                    (keybind.match("history_previous", e) && input.cursorOffset === 0) ||
                    (keybind.match("history_next", e) && input.cursorOffset === input.plainText.length)
                  ) {
                    const direction = keybind.match("history_previous", e) ? -1 : 1
                    const item = history.move(direction, input.plainText)

                    if (item) {
                      input.setText(item.input)
                      setStore("prompt", item)
                      setStore("mode", item.mode ?? "normal")
                      restoreExtmarksFromParts(item.parts)
                      e.preventDefault()
                      if (direction === -1) input.cursorOffset = 0
                      if (direction === 1) input.cursorOffset = input.plainText.length
                    }
                    return
                  }

                  if (keybind.match("history_previous", e) && input.visualCursor.visualRow === 0) input.cursorOffset = 0
                  if (keybind.match("history_next", e) && input.visualCursor.visualRow === input.height - 1)
                    input.cursorOffset = input.plainText.length
                }
              }}
              onSubmit={submit}
              onPaste={async (event: PasteEvent) => {
                if (props.disabled) {
                  event.preventDefault()
                  return
                }

                // Normalize line endings at the boundary
                // Windows ConPTY/Terminal often sends CR-only newlines in bracketed paste
                // Replace CRLF first, then any remaining CR
                const normalizedText = event.text.replace(/\r\n/g, "\n").replace(/\r/g, "\n")
                const pastedContent = normalizedText.trim()
                if (!pastedContent) {
                  command.trigger("prompt.paste")
                  return
                }

                // trim ' from the beginning and end of the pasted content. just
                // ' and nothing else
                const filepath = pastedContent.replace(/^'+|'+$/g, "").replace(/\\ /g, " ")
                const isUrl = /^(https?):\/\//.test(filepath)
                if (!isUrl) {
                  try {
                    const mime = Filesystem.mimeType(filepath)
                    const filename = path.basename(filepath)
                    // Handle SVG as raw text content, not as base64 image
                    if (mime === "image/svg+xml") {
                      event.preventDefault()
                      const content = await Filesystem.readText(filepath).catch(() => {})
                      if (content) {
                        pasteText(content, `[SVG: ${filename ?? "image"}]`)
                        return
                      }
                    }
                    if (mime.startsWith("image/")) {
                      event.preventDefault()
                      const content = await Filesystem.readArrayBuffer(filepath)
                        .then((buffer) => Buffer.from(buffer).toString("base64"))
                        .catch(() => {})
                      if (content) {
                        await pasteImage({
                          filename,
                          mime,
                          content,
                        })
                        return
                      }
                    }
                  } catch {}
                }

                const lineCount = (pastedContent.match(/\n/g)?.length ?? 0) + 1
                if (
                  (lineCount >= 3 || pastedContent.length > 150) &&
                  !sync.data.config.experimental?.disable_paste_summary
                ) {
                  event.preventDefault()
                  pasteText(pastedContent, `[Pasted ~${lineCount} lines]`)
                  return
                }

                // Force layout update and render for the pasted content
                setTimeout(() => {
                  // setTimeout is a workaround and needs to be addressed properly
                  if (!input || input.isDestroyed) return
                  input.getLayoutNode().markDirty()
                  renderer.requestRender()
                }, 0)
              }}
              ref={(r: TextareaRenderable) => {
                input = r
                if (promptPartTypeId === 0) {
                  promptPartTypeId = input.extmarks.registerType("prompt-part")
                }
                props.ref?.(ref)
                setTimeout(() => {
                  // setTimeout is a workaround and needs to be addressed properly
                  if (!input || input.isDestroyed) return
                  input.cursorColor = theme.text
                }, 0)
              }}
              onMouseDown={(r: MouseEvent) => r.target?.focus()}
              focusedBackgroundColor={theme.backgroundElement}
              cursorColor={theme.text}
              syntaxStyle={syntax()}
            />
            <box flexDirection="row" flexShrink={0} paddingTop={1} gap={1}>
              <text fg={highlight()}>
                {store.mode === "shell" ? "Shell" : Locale.titlecase(local.agent.current().name)}{" "}
              </text>
              <Show when={store.mode === "normal"}>
                <box flexDirection="row" gap={1}>
                  <text flexShrink={0} fg={keybind.leader ? theme.textMuted : theme.text}>
                    {local.model.parsed().model}
                  </text>
                  <text fg={theme.textMuted}>{local.model.parsed().provider}</text>
                  <Show when={showVariant()}>
                    <text fg={theme.textMuted}>·</text>
                    <text>
                      <span style={{ fg: theme.warning, bold: true }}>{local.model.variant.current()}</span>
                    </text>
                  </Show>
                </box>
              </Show>
            </box>
          </box>
        </box>
        <box
          height={1}
          border={["left"]}
          borderColor={highlight()}
          customBorderChars={{
            ...EmptyBorder,
            vertical: theme.backgroundElement.a !== 0 ? "╹" : " ",
          }}
        >
          <box
            height={1}
            border={["bottom"]}
            borderColor={theme.backgroundElement}
            customBorderChars={
              theme.backgroundElement.a !== 0
                ? {
                    ...EmptyBorder,
                    horizontal: "▀",
                  }
                : {
                    ...EmptyBorder,
                    horizontal: " ",
                  }
            }
          />
        </box>
        <Show when={queuedPromptsForSession().length > 0}>
          <box paddingLeft={1} paddingBottom={1} gap={0}>
            <For each={queuedPromptsForSession().slice(0, 2)}>
              {(item, index) => {
                const editing = createMemo(() => queuedEditID() === item.id)
                return (
                  <text fg={editing() ? theme.text : theme.textMuted}>
                    <span style={{ fg: editing() ? theme.text : theme.textMuted }}>
                      {editing() ? "● editing end-loop" : "○ queued end-loop"} {index() + 1}
                    </span>
                    <span style={{ fg: theme.textMuted }}> · {queuedPreview(item.inputText)}</span>
                  </text>
                )
              }}
            </For>
            <Show when={queuedPromptsForSession().length > 2}>
              <text fg={theme.textMuted}>+{queuedPromptsForSession().length - 2} more queued</text>
            </Show>
          </box>
        </Show>
        <box flexDirection="row" justifyContent="space-between">
          <Show when={status().type !== "idle"} fallback={<text />}>
            <box
              flexDirection="row"
              gap={1}
              flexGrow={1}
              justifyContent={status().type === "retry" ? "space-between" : "flex-start"}
            >
              <box flexShrink={0} flexDirection="row" gap={1}>
                <box marginLeft={1}>
                  <Show when={kv.get("animations_enabled", true)} fallback={<text fg={theme.textMuted}>[⋯]</text>}>
                    <spinner color={spinnerDef().color} frames={spinnerDef().frames} interval={40} />
                  </Show>
                </box>
                <box flexDirection="row" gap={1} flexShrink={0}>
                  {(() => {
                    const retry = createMemo(() => {
                      const s = status()
                      if (s.type !== "retry") return
                      return s
                    })
                    const message = createMemo(() => {
                      const r = retry()
                      if (!r) return
                      if (r.message.includes("exceeded your current quota") && r.message.includes("gemini"))
                        return "gemini is way too hot right now"
                      if (r.message.length > 80) return r.message.slice(0, 80) + "..."
                      return r.message
                    })
                    const isTruncated = createMemo(() => {
                      const r = retry()
                      if (!r) return false
                      return r.message.length > 120
                    })
                    const [seconds, setSeconds] = createSignal(0)
                    onMount(() => {
                      const timer = setInterval(() => {
                        const next = retry()?.next
                        if (next) setSeconds(Math.round((next - Date.now()) / 1000))
                      }, 1000)

                      onCleanup(() => {
                        clearInterval(timer)
                      })
                    })
                    const handleMessageClick = () => {
                      const r = retry()
                      if (!r) return
                      if (isTruncated()) {
                        DialogAlert.show(dialog, "Retry Error", r.message)
                      }
                    }

                    const retryText = () => {
                      const r = retry()
                      if (!r) return ""
                      const baseMessage = message()
                      const truncatedHint = isTruncated() ? " (click to expand)" : ""
                      const duration = formatDuration(seconds())
                      const retryInfo = ` [retrying ${duration ? `in ${duration} ` : ""}attempt #${r.attempt}]`
                      return baseMessage + truncatedHint + retryInfo
                    }

                    return (
                      <Show when={retry()}>
                        <box onMouseUp={handleMessageClick}>
                          <text fg={theme.error}>{retryText()}</text>
                        </box>
                      </Show>
                    )
                  })()}
                </box>
              </box>
              <text fg={store.interrupt > 0 ? theme.primary : theme.text}>
                esc{" "}
                <span style={{ fg: store.interrupt > 0 ? theme.primary : theme.textMuted }}>
                  {store.interrupt > 0 ? "again to interrupt" : "interrupt"}
                </span>
              </text>
            </box>
          </Show>
          <Show when={status().type !== "retry"}>
            <box gap={2} flexDirection="row">
              <Switch>
                <Match when={store.mode === "normal"}>
                  <Show when={local.model.variant.list().length > 0}>
                    <text fg={theme.text}>
                      {keybind.print("variant_cycle")} <span style={{ fg: theme.textMuted }}>variants</span>
                    </text>
                  </Show>
                  <text fg={theme.text}>
                    {keybind.print("agent_cycle")} <span style={{ fg: theme.textMuted }}>agents</span>
                  </text>
                  <text fg={theme.text}>
                    {keybind.print("command_list")} <span style={{ fg: theme.textMuted }}>commands</span>
                  </text>
                </Match>
                <Match when={store.mode === "shell"}>
                  <text fg={theme.text}>
                    esc <span style={{ fg: theme.textMuted }}>exit shell mode</span>
                  </text>
                </Match>
              </Switch>
            </box>
          </Show>
        </box>
      </box>
    </>
  )
}
