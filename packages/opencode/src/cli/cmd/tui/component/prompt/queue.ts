import type { PromptInfo } from "./history"

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

export function mergeQueuedPrompt(
  target: { inputText: string; parts: PromptInfo["parts"] },
  current: { inputText: string; nonTextParts: PromptInfo["parts"] },
) {
  const inputText = appendInput(target.inputText, current.inputText)
  const offset = inputText.length - current.inputText.length
  return {
    inputText,
    parts: [...structuredClone(target.parts), ...shiftParts(current.nonTextParts, offset)],
  }
}

export function removeQueued<T extends { id: string }>(list: T[], id: string, index: number) {
  const next = list.filter((item) => item.id !== id)
  if (next.length === 0) {
    return {
      list: next,
    }
  }
  const cursor = Math.min(index, next.length - 1)
  return {
    list: next,
    cursor,
    item: next[cursor],
  }
}
