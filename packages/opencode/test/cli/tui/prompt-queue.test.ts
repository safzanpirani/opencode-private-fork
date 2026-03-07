import { describe, expect, test } from "bun:test"
import { mergeQueuedPrompt, removeQueued } from "../../../src/cli/cmd/tui/component/prompt/queue"

describe("mergeQueuedPrompt", () => {
  test("appends existing draft below queued text with a blank line", () => {
    const result = mergeQueuedPrompt(
      {
        inputText: "do this and that",
        parts: [],
      },
      {
        inputText: "and also do this",
        nonTextParts: [],
      },
    )

    expect(result.inputText).toBe("do this and that\n\nand also do this")
    expect(result.parts).toEqual([])
  })

  test("preserves queued parts and shifts current draft parts to appended positions", () => {
    const result = mergeQueuedPrompt(
      {
        inputText: "queued",
        parts: [
          {
            type: "file",
            mime: "text/plain",
            filename: "queued.txt",
            url: "file:///queued.txt",
            source: {
              type: "file",
              path: "queued.txt",
              text: {
                start: 0,
                end: 8,
                value: "[Queued]",
              },
            },
          },
        ],
      },
      {
        inputText: "draft",
        nonTextParts: [
          {
            type: "file",
            mime: "text/plain",
            filename: "draft.txt",
            url: "file:///draft.txt",
            source: {
              type: "file",
              path: "draft.txt",
              text: {
                start: 0,
                end: 7,
                value: "[Draft]",
              },
            },
          },
        ],
      },
    )

    expect(result.inputText).toBe("queued\n\ndraft")
    expect(result.parts).toHaveLength(2)
    expect(result.parts[0]).toMatchObject({
      type: "file",
      filename: "queued.txt",
      source: {
        text: {
          start: 0,
          end: 8,
        },
      },
    })
    expect(result.parts[1]).toMatchObject({
      type: "file",
      filename: "draft.txt",
      source: {
        text: {
          start: 8,
          end: 15,
        },
      },
    })
  })

  test("reusing the original draft while cycling does not compound appended text", () => {
    const draft = {
      inputText: "and also do this",
      nonTextParts: [],
    }

    const first = mergeQueuedPrompt(
      {
        inputText: "do this and that",
        parts: [],
      },
      draft,
    )

    const second = mergeQueuedPrompt(
      {
        inputText: "do something else",
        parts: [],
      },
      draft,
    )

    expect(first.inputText).toBe("do this and that\n\nand also do this")
    expect(second.inputText).toBe("do something else\n\nand also do this")
  })

  test("removeQueued keeps selection at the next available item", () => {
    const result = removeQueued(
      [
        { id: "c", value: "third" },
        { id: "b", value: "second" },
        { id: "a", value: "first" },
      ],
      "b",
      1,
    )

    expect(result.list).toEqual([
      { id: "c", value: "third" },
      { id: "a", value: "first" },
    ])
    expect(result.cursor).toBe(1)
    expect(result.item).toEqual({ id: "a", value: "first" })
  })

  test("removeQueued clears selection when queue becomes empty", () => {
    const result = removeQueued([{ id: "a", value: "first" }], "a", 0)

    expect(result.list).toEqual([])
    expect(result.cursor).toBeUndefined()
    expect(result.item).toBeUndefined()
  })
})
