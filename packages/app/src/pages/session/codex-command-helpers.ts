export type CodexUsageCommand = {
  kind: "usage"
  providerID: "openai" | ""
  providerToken?: string
}

export type CodexSwapCommand =
  | {
      kind: "codexswap"
      action: "status" | "next" | "add"
      label?: string
      current?: boolean
    }
  | {
      kind: "codexswap"
      action: "use"
      selector?: string
    }

export type CodexCommand = CodexUsageCommand | { kind: "codexwho" } | CodexSwapCommand

export function usageProvider(value: string | undefined) {
  if (!value) return "openai"
  const text = value.toLowerCase()
  if (["openai", "codex", "chatgpt", "gpt"].includes(text)) return "openai"
  return ""
}

export function parseCodexCommand(input: string): CodexCommand | undefined {
  const parts = input.trim().split(/\s+/).filter(Boolean)
  const head = parts[0]?.toLowerCase()
  if (!head) return

  if (head === "/usage") {
    const providerToken = parts.slice(1).find((part) => !part.startsWith("-"))
    return {
      kind: "usage",
      providerID: usageProvider(providerToken),
      providerToken,
    }
  }

  if (head === "/codexwho") {
    return { kind: "codexwho" }
  }

  if (head !== "/codexswap") return
  const sub = (parts[1] ?? "next").toLowerCase()
  if (sub === "status" || sub === "list" || sub === "who") {
    return { kind: "codexswap", action: "status" }
  }

  if (sub === "save" || sub === "save-current") {
    return {
      kind: "codexswap",
      action: "add",
      current: true,
      label: parts.slice(2).join(" ").trim() || undefined,
    }
  }

  if (sub === "add") {
    const current = parts[2] === "--current" || parts[2] === "-c"
    return {
      kind: "codexswap",
      action: "add",
      current,
      label:
        parts
          .slice(current ? 3 : 2)
          .join(" ")
          .trim() || undefined,
    }
  }

  if (sub === "next") {
    return { kind: "codexswap", action: "next" }
  }

  if (sub === "use") {
    return {
      kind: "codexswap",
      action: "use",
      selector: parts.slice(2).join(" ").trim() || undefined,
    }
  }
}
