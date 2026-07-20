import { describe, expect, it } from "vitest";
import { discoverOpid } from "../src/index";

describe("URL-identity discovery", () => {
  it("derives one origin key name and one same-origin record URL", () => {
    expect(discoverOpid("https://CUSTOMER.OPID.PROVIDER/product/1223")).toEqual(
      {
        opid: "https://customer.opid.provider/product/1223",
        recordUrl:
          "https://customer.opid.provider/.well-known/open-payment/record/L3Byb2R1Y3QvMTIyMw",
        trustName: "_opap.customer.opid.provider",
      },
    );
  });
});
