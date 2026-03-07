import type { PromptInfo } from "./history"

type Prompt = {
  inputText: string
  parts: PromptInfo["parts"]
}

function appendInput(base: string, extra: string) {
  if (!base) return extra
  if (!extra) return base
  if (base.endsWith("\n\n")) return base + extra
  if (base.endsWith("\n")) return base + "\n" + extra
  return base + "\n\n" + extra
}

function shiftParts(parts: PromptInfo["parts"], offset: number) {
  if (offset === 0) return structuredClone(parts)
  return parts.map((part) => {
    const next = structuredClone(part)
    if (next.type === "agent" && next.source) {
      next.source.start += offset
      next.source.end += offset
      return next
    }
    if ((next.type === "file" || next.type === "text") && next.source && "text" in next.source) {
      next.source.text.start += offset
      next.source.text.end += offset
    }
    return next
  })
}

function mergePrompt(base: Prompt, extra: Prompt) {
  const inputText = appendInput(base.inputText, extra.inputText)
  const offset = inputText.length - extra.inputText.length
  return {
    inputText,
    parts: [...structuredClone(base.parts), ...shiftParts(extra.parts, offset)],
  }
}

export function mergeQueuedPrompt(target: Prompt, current: { inputText: string; nonTextParts: PromptInfo["parts"] }) {
  return mergePrompt(target, {
    inputText: current.inputText,
    parts: current.nonTextParts,
  })
}

export function combineQueuedPrompts(
  list: Prompt[],
  current?: { inputText: string; nonTextParts: PromptInfo["parts"] },
) {
  const first = list[0]
  if (!first) {
    return {
      inputText: current?.inputText ?? "",
      parts: structuredClone(current?.nonTextParts ?? []),
    }
  }

  const combined = list.slice(1).reduce((acc, item) => mergePrompt(acc, item), structuredClone(first))
  if (!current) return combined
  return mergeQueuedPrompt(combined, current)
}
