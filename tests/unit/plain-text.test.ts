import { describe, expect, it } from "vitest";
import { plainText } from "@/lib/plain-text";

describe("plainText", () => {
  it("removes bold, italics, headings, code and links", () => {
    expect(plainText("**Pay the florist** first")).toBe("Pay the florist first");
    expect(plainText("## Next up\nThe *caterer* deposit")).toBe("Next up\nThe caterer deposit");
    expect(plainText("Use `capture` [here](https://x.y)")).toBe("Use capture here");
    expect(plainText("* one\n* two")).toBe("- one\n- two");
  });
  it("leaves plain text and money alone", () => {
    expect(plainText("$10,640 is not $10,460 (2 * 3)")).toBe("$10,640 is not $10,460 (2 * 3)");
    expect(plainText(undefined)).toBeUndefined();
  });
  it("never leaves a stray double star", () => {
    expect(plainText("**unclosed bold")).toBe("unclosed bold");
  });
});
