import { test } from "node:test";
import assert from "node:assert/strict";
import { allRows } from "../server/pagination.js";
test("reads past the API limit without losing history", async () => {
  const values = Array.from({ length: 1251 }, (_, id) => ({ id }));
  let calls = 0;
  const result = await allRows(async (from, to) => {
    calls++;
    return { data: values.slice(from, to + 1), error: null };
  });
  assert.equal(calls, 3);
  assert.deepEqual(result.data, values);
});
test("does not report partial totals when a later page fails", async () => {
  const result = await allRows(async (from) =>
    from === 0
      ? { data: Array(500).fill(1), error: null }
      : { data: null, error: { message: "offline" } },
  );
  assert.equal(result.data, null);
  assert.equal(result.error?.message, "offline");
});
