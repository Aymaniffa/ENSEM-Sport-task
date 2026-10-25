import { z } from "zod";
export const id = z.uuid();
export const roles = ["member", "manager", "admin"];
export const statuses = ["todo", "in_progress", "done"];
export const attendanceStatuses = ["present", "absent", "excused"];
export const profileSchema = z.object({
  full_name: z.string().trim().min(2).max(100),
  department: z.string().trim().max(100),
  bio: z.string().trim().max(1000),
});
export const missionSchema = z.object({
  title: z.string().trim().min(3).max(160),
  description: z.string().trim().max(5000),
  assignee_id: id,
  due_date: z.iso.date(),
});
export const meetingSchema = z.object({
  title: z.string().trim().min(3).max(160),
  location: z.string().trim().min(2).max(200),
  starts_at: z.iso.datetime({ offset: true }),
  agenda: z.string().trim().max(5000),
});
export const MAX_FILE_SIZE = 10 * 1024 * 1024;
export const fileTypes = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
];
export function validFile(size, type) {
  return size > 0 && size <= MAX_FILE_SIZE && fileTypes.includes(type);
}
export function isStaff(role) {
  return role === "admin" || role === "manager";
}
export function completionRate(done, total) {
  return total === 0 ? 0 : Math.round((done / total) * 100);
}
