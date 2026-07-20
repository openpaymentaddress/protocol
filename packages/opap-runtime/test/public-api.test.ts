import { expect, it } from "vitest";

import { validateOpapRecordBytes } from "../src/index";

it("exposes core record validation through the runtime facade", () => {
  const bytes = new TextEncoder().encode(
    JSON.stringify({
      version: 1,
      id: "https://merchant.example/",
      payment: { type: "delegate", target: "https://recipient.example/" },
    }),
  );

  expect(validateOpapRecordBytes(bytes).id).toBe("https://merchant.example/");
});
