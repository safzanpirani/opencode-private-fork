import { describe, expect, test } from "bun:test"
import { combineQueuedPrompts, mergeQueuedPrompt } from "../../../src/cli/cmd/tui/component/prompt/queue"

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

  test("combineQueuedPrompts merges queued messages in send order and appends current draft last", () => {
    const result = combineQueuedPrompts(
      [
        {
          inputText: "first queued",
          parts: [],
        },
        {
          inputText: "second queued",
          parts: [],
        },
      ],
      {
        inputText: "current draft",
        nonTextParts: [],
      },
    )

    expect(result.inputText).toBe("first queued\n\nsecond queued\n\ncurrent draft")
    expect(result.parts).toEqual([])
  })

  test("combineQueuedPrompts shifts later queued parts and current draft parts", () => {
    const result = combineQueuedPrompts(
      [
        {
          inputText: "first",
          parts: [
            {
              type: "file",
              mime: "text/plain",
              filename: "first.txt",
              url: "file:///first.txt",
              source: {
                type: "file",
                path: "first.txt",
                text: {
                  start: 0,
                  end: 7,
                  value: "[First]",
                },
              },
            },
          ],
        },
        {
          inputText: "second",
          parts: [
            {
              type: "file",
              mime: "text/plain",
              filename: "second.txt",
              url: "file:///second.txt",
              source: {
                type: "file",
                path: "second.txt",
                text: {
                  start: 0,
                  end: 8,
                  value: "[Second]",
                },
              },
            },
          ],
        },
      ],
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

    expect(result.inputText).toBe("first\n\nsecond\n\ndraft")
    expect(result.parts).toHaveLength(3)
    expect(result.parts[0]).toMatchObject({ filename: "first.txt", source: { text: { start: 0, end: 7 } } })
    expect(result.parts[1]).toMatchObject({ filename: "second.txt", source: { text: { start: 7, end: 15 } } })
    expect(result.parts[2]).toMatchObject({ filename: "draft.txt", source: { text: { start: 15, end: 22 } } })
  })
})
