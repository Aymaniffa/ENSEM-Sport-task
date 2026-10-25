import { test } from "node:test";
import assert from "node:assert/strict";
import {
  profileSchema,
  missionSchema,
  meetingSchema,
  validFile,
  MAX_FILE_SIZE,
  isStaff,
  completionRate,
} from "../server/validation.js";
test("profile accepts editable fields only, strips injected role", () => {
  const profile = profileSchema.parse({
    full_name: "  Test Member  ",
    department: "GI",
    bio: "",
    role: "admin",
  });
  assert.deepEqual(profile, {
    full_name: "Test Member",
    department: "GI",
    bio: "",
  });
});
test("missions reject invalid dates, identifiers and empty titles", () => {
  const valid = {
    title: "Mission pilote",
    description: "",
    assignee_id: "10000000-0000-4000-8000-000000000001",
    due_date: "2026-11-01",
  };
  assert.equal(missionSchema.safeParse(valid).success, true);
  for (const change of [
    { due_date: "2026-02-30" },
    { assignee_id: "admin" },
    { title: "  " },
  ])
    assert.equal(
      missionSchema.safeParse({ ...valid, ...change }).success,
      false,
    );
});
test("meeting timestamps require a timezone to avoid device timezone ambiguity", () => {
  const valid = {
    title: "Réunion pilote",
    location: "Salle 1",
    starts_at: "2026-11-01T18:00:00Z",
    agenda: "",
  };
  assert.equal(meetingSchema.safeParse(valid).success, true);
  assert.equal(
    meetingSchema.safeParse({ ...valid, starts_at: "2026-11-01T18:00" })
      .success,
    false,
  );
});
test("uploads reject empty, oversized and executable files", () => {
  assert.equal(validFile(1, "application/pdf"), true);
  assert.equal(validFile(MAX_FILE_SIZE, "application/pdf"), true);
  assert.equal(validFile(0, "application/pdf"), false);
  assert.equal(validFile(MAX_FILE_SIZE + 1, "application/pdf"), false);
  assert.equal(validFile(100, "text/html"), false);
  assert.equal(validFile(100, "application/x-msdownload"), false);
});
test("roles and empty statistics", () => {
  assert.equal(isStaff("member"), false);
  assert.equal(isStaff("manager"), true);
  assert.equal(isStaff("admin"), true);
  assert.equal(completionRate(0, 0), 0);
  assert.equal(completionRate(1, 3), 33);
});
