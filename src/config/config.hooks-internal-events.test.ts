import { describe, expect, it } from "vitest";
import { validateConfigObject } from "./validation.js";

describe("config: hooks.internal event validation", () => {
  it("rejects unknown internal hook events with a precise error", () => {
    const result = validateConfigObject({
      hooks: {
        internal: {
          enabled: true,
          handlers: [
            {
              event: "command:launch",
              module: "./hooks/custom.js",
            },
          ],
        },
      },
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }

    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "hooks.internal.handlers.0.event",
          message: expect.stringContaining('Unknown internal hook event "command:launch"'),
        }),
      ]),
    );
  });
});
