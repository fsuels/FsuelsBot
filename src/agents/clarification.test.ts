import { describe, expect, it } from "vitest";
import {
  normalizeClarificationQuestions,
  parseClarificationResponse,
  type ClarificationInput,
} from "./clarification.js";

function buildInput(overrides?: Partial<ClarificationInput>): ClarificationInput {
  return {
    questions: [
      {
        id: "layout",
        header: "Layout",
        question: "Which layout should I use?",
        options: [
          {
            id: "cards",
            label: "Cards",
            description: "Compact cards with metadata.",
          },
          {
            id: "table",
            label: "Table",
            description: "Dense table view.",
          },
        ],
      },
    ],
    ...overrides,
  };
}

describe("clarification", () => {
  it("rejects duplicate question ids", () => {
    expect(() =>
      normalizeClarificationQuestions({
        questions: [
          ...buildInput().questions,
          {
            id: "layout",
            header: "Theme",
            question: "Which theme should I use?",
            options: [
              { id: "light", label: "Light", description: "Bright palette." },
              { id: "dark", label: "Dark", description: "Dark palette." },
            ],
          },
        ],
      }),
    ).toThrow('Duplicate question id "layout"');
  });

  it("rejects duplicate option ids and labels", () => {
    expect(() =>
      normalizeClarificationQuestions({
        questions: [
          {
            id: "layout",
            header: "Layout",
            question: "Which layout should I use?",
            options: [
              { id: "cards", label: "Cards", description: "Compact cards." },
              { id: "cards", label: "Table", description: "Dense table." },
            ],
          },
        ],
      }),
    ).toThrow('duplicate option id "cards"');

    expect(() =>
      normalizeClarificationQuestions({
        questions: [
          {
            id: "layout",
            header: "Layout",
            question: "Which layout should I use?",
            options: [
              { id: "cards", label: "Cards", description: "Compact cards." },
              { id: "table", label: "Cards", description: "Dense table." },
            ],
          },
        ],
      }),
    ).toThrow('duplicate option label "Cards"');
  });

  it("blocks previews on multi-select questions", () => {
    expect(() =>
      normalizeClarificationQuestions({
        questions: [
          {
            id: "filters",
            header: "Filters",
            question: "Which filters should I enable?",
            multiSelect: true,
            options: [
              {
                id: "drafts",
                label: "Drafts",
                description: "Show drafts.",
                preview: "draft preview",
              },
              {
                id: "published",
                label: "Published",
                description: "Show published.",
              },
            ],
          },
        ],
      }),
    ).toThrow("cannot use previews with multiSelect=true");
  });

  it("sanitizes unsafe html previews", () => {
    const questions = normalizeClarificationQuestions({
      questions: [
        {
          id: "preview",
          header: "Preview",
          question: "Which preview should I use?",
          options: [
            {
              id: "safe",
              label: "Safe",
              description: "Sanitized html preview.",
              preview:
                '<div onclick="evil()"><script>alert(1)</script><a href="javascript:evil()">Click</a><strong>Safe</strong></div>',
              previewFormat: "html",
            },
            {
              id: "plain",
              label: "Plain",
              description: "No preview.",
            },
          ],
        },
      ],
    });
    const preview = questions[0]?.options[0]?.preview ?? "";
    expect(preview).toContain("Click");
    expect(preview).toContain("Safe");
    expect(preview).not.toContain("script");
    expect(preview).not.toContain("javascript:");
    expect(preview).not.toContain("onclick");
  });

  it("stores multi-select answers as arrays keyed by stable question ids", () => {
    const pending = {
      promptId: "abc12345",
      askedAt: Date.now(),
      promptText: "prompt",
      delivery: {
        transport: "plain_text" as const,
        interactiveUi: false,
        fallbackUsed: false,
      },
      questions: normalizeClarificationQuestions({
        questions: [
          {
            id: "filters",
            header: "Filters",
            question: "Which filters should I enable?",
            multiSelect: true,
            options: [
              { id: "drafts", label: "Drafts", description: "Show drafts." },
              { id: "published", label: "Published", description: "Show published." },
            ],
          },
        ],
      }),
    };

    const result = parseClarificationResponse({
      pending,
      message: "1,2",
    });

    expect(result).toEqual({
      kind: "answered",
      answers: [
        {
          questionId: "filters",
          selectedOptionIds: ["drafts", "published"],
          selectedPreview: undefined,
        },
      ],
    });
  });

  it("maps replies by question id instead of question text", () => {
    const pending = {
      promptId: "abc12345",
      askedAt: Date.now(),
      promptText: "prompt",
      delivery: {
        transport: "plain_text" as const,
        interactiveUi: false,
        fallbackUsed: false,
      },
      questions: normalizeClarificationQuestions({
        questions: [
          {
            id: "tema",
            header: "Tema",
            question: "Cual tema debo usar?",
            options: [
              { id: "claro", label: "Claro", description: "Tema claro." },
              { id: "oscuro", label: "Oscuro", description: "Tema oscuro." },
            ],
          },
        ],
      }),
    };

    const result = parseClarificationResponse({
      pending,
      message: "oscuro",
    });

    expect(result).toEqual({
      kind: "answered",
      answers: [
        {
          questionId: "tema",
          selectedOptionIds: ["oscuro"],
          selectedPreview: undefined,
        },
      ],
    });
  });
});
