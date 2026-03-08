import { describe, expect, test } from "bun:test"
import { parseCodexCommand, usageProvider } from "./codex-command-helpers"

describe("codex command helpers", () => {
  test("normalizes usage provider aliases", () => {
    expect(usageProvider(undefined)).toBe("openai")
    expect(usageProvider("codex")).toBe("openai")
    expect(usageProvider("chatgpt")).toBe("openai")
    expect(usageProvider("gpt")).toBe("openai")
    expect(usageProvider("anthropic")).toBe("")
  })

  test("parses /usage commands", () => {
    expect(parseCodexCommand("/usage")).toEqual({ kind: "usage", providerID: "openai", providerToken: undefined })
    expect(parseCodexCommand("/usage codex")).toEqual({ kind: "usage", providerID: "openai", providerToken: "codex" })
  })

  test("parses /codexwho", () => {
    expect(parseCodexCommand("/codexwho")).toEqual({ kind: "codexwho" })
  })

  test("parses /codexswap variants", () => {
    expect(parseCodexCommand("/codexswap")).toEqual({ kind: "codexswap", action: "next" })
    expect(parseCodexCommand("/codexswap status")).toEqual({ kind: "codexswap", action: "status" })
    expect(parseCodexCommand("/codexswap use work")).toEqual({ kind: "codexswap", action: "use", selector: "work" })
    expect(parseCodexCommand("/codexswap save main")).toEqual({
      kind: "codexswap",
      action: "add",
      current: true,
      label: "main",
    })
    expect(parseCodexCommand("/codexswap add browser")).toEqual({
      kind: "codexswap",
      action: "add",
      current: false,
      label: "browser",
    })
    expect(parseCodexCommand("/codexswap add --current browser")).toEqual({
      kind: "codexswap",
      action: "add",
      current: true,
      label: "browser",
    })
  })
})
