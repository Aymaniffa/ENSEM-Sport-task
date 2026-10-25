import { test } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { registrationSchema } from "../server/registration.js";
import { normalizePhoto } from "../server/photo.js";
const member = {
  username: "Member.Test",
  first_name: "Membre",
  last_name: "Test",
  department: "GI",
  academic_year: "2026-2027",
  cells: ["Event", "Design"],
  password: "Test-password-12345",
  confirmation: "Test-password-12345",
};
test("registration validates names, cells, academic year and confirmation", () => {
  assert.equal(registrationSchema.parse(member).username, "member.test");
  for (const changes of [
    { cells: [] },
    { cells: ["Admin"] },
    { academic_year: "2026-2029" },
    { confirmation: "different" },
    { username: "x" },
    { first_name: "" },
  ])
    assert.equal(
      registrationSchema.safeParse({ ...member, ...changes }).success,
      false,
    );
});
test("profile pictures are decoded, resized and reencoded; fake images rejected", async () => {
  const input = await sharp({
    create: { width: 600, height: 400, channels: 3, background: "#002fa7" },
  })
    .png()
    .toBuffer();
  const output = await normalizePhoto(
    new File([input], "test.png", { type: "image/png" }),
  );
  const metadata = await sharp(output).metadata();
  assert.equal(metadata.width, 320);
  assert.equal(metadata.height, 320);
  assert.equal(metadata.format, "jpeg");
  assert.equal(metadata.exif, undefined);
  await assert.rejects(() =>
    normalizePhoto(
      new File(["not an image"], "fake.jpg", { type: "image/jpeg" }),
    ),
  );
  await assert.rejects(() =>
    normalizePhoto(
      new File([new Uint8Array(2 * 1024 * 1024 + 1)], "large.jpg", {
        type: "image/jpeg",
      }),
    ),
  );
});
