import { describe, expect, it } from "vitest";
import { prepareSearchItems, rankSearchItems } from "./fuzzy-filter.js";

describe("rankSearchItems", () => {
  it("keeps exact label matches ahead of fuzzy description matches", () => {
    const items = prepareSearchItems([
      {
        value: "desc-only",
        label: "provider/other",
        description: "Useful when you need hs in the summary",
      },
      {
        value: "label-exact",
        label: "hs",
        description: "Exact label match",
      },
    ]);

    const ranked = rankSearchItems(items, "hs");

    expect(ranked.map((item) => item.value)).toEqual(["label-exact", "desc-only"]);
  });

  it("prefers exact alias matches over label prefix matches", () => {
    const items = prepareSearchItems([
      {
        value: "prefix-label",
        label: "reviewer",
        description: "Prefix label only",
      },
      {
        value: "exact-alias",
        label: "agent",
        description: "Matched by alias",
        searchAliases: ["review"],
      },
    ]);

    const ranked = rankSearchItems(items, "review");

    expect(ranked.map((item) => item.value)).toEqual(["exact-alias", "prefix-label"]);
  });

  it("prefers shorter prefix matches within the same tier", () => {
    const items = prepareSearchItems([
      {
        value: "longer",
        label: "commands-helpful",
      },
      {
        value: "shorter",
        label: "help",
      },
    ]);

    const ranked = rankSearchItems(items, "help");

    expect(ranked.map((item) => item.value)).toEqual(["shorter", "longer"]);
  });

  it("keeps duplicate labels selectable by preserving stable values", () => {
    const items = prepareSearchItems([
      {
        value: "status:built-in:core",
        label: "status",
      },
      {
        value: "status:plugin:workspace",
        label: "status",
      },
    ]);

    const ranked = rankSearchItems(items, "status");

    expect(ranked.map((item) => item.value)).toEqual([
      "status:built-in:core",
      "status:plugin:workspace",
    ]);
  });
});
