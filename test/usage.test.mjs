import assert from "node:assert/strict";
import test from "node:test";

import { formatUsage, shouldShowAdditionalLimit } from "../dist/usage.js";

const sparkBucket = {
  limit_name: "GPT-5.3-Codex-Spark",
  metered_feature: "codex_bengalfox",
  rate_limit: {
    allowed: true,
    limit_reached: false,
    primary_window: {
      used_percent: 0,
      limit_window_seconds: 604800,
      reset_after_seconds: 604800,
      reset_at: 1788535699,
    },
    secondary_window: null,
  },
};

function plusUsage() {
  return {
    plan_type: "plus",
    rate_limit: {
      allowed: false,
      limit_reached: true,
      primary_window: {
        used_percent: 100,
        limit_window_seconds: 18000,
        reset_after_seconds: 10117,
      },
      secondary_window: {
        used_percent: 31,
        limit_window_seconds: 604800,
        reset_after_seconds: 578670,
      },
    },
    additional_rate_limits: [sparkBucket],
  };
}

test("hides unused Spark extra bucket on Plus", () => {
  const formatted = formatUsage("plus@example.com", true, plusUsage());

  assert.equal(formatted.planType, "plus");
  assert.equal(formatted.additionalLimits, undefined);
});

test("shows Spark extra bucket on Pro", () => {
  const formatted = formatUsage("pro@example.com", true, {
    ...plusUsage(),
    plan_type: "pro",
  });

  assert.equal(formatted.additionalLimits?.length, 1);
  assert.equal(formatted.additionalLimits[0].name, "GPT-5.3-Codex-Spark");
});

test("shouldShowAdditionalLimit treats Spark as Pro-only", () => {
  assert.equal(shouldShowAdditionalLimit(sparkBucket, "plus"), false);
  assert.equal(shouldShowAdditionalLimit(sparkBucket, "pro"), true);
  assert.equal(
    shouldShowAdditionalLimit({
      limit_name: "premium",
      rate_limit: { allowed: true, limit_reached: false },
    }, "plus"),
    true,
  );
});
