import { z } from "zod";
export const CELLS = [
  "Event",
  "Sponsoring",
  "Communication",
  "Média",
  "Design",
  "Soirée et Show",
  "Logistique",
  "Jeux et Sport",
];
export const memberDetailsSchema = z.object({
  first_name: z.string().trim().min(2, "Indiquez votre prénom.").max(50),
  last_name: z.string().trim().min(2, "Indiquez votre nom.").max(50),
  department: z.string().trim().min(2, "Indiquez votre filière.").max(100),
  academic_year: z
    .string()
    .regex(/^20\d{2}-20\d{2}$/, "Année universitaire attendue : 2026-2027.")
    .refine(
      (v) => Number(v.slice(5)) === Number(v.slice(0, 4)) + 1,
      "Indiquez deux années consécutives.",
    ),
  cells: z
    .array(z.enum(CELLS))
    .min(1, "Choisissez au moins une cellule.")
    .max(CELLS.length)
    .transform((v) => [...new Set(v)]),
});
export const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(
    /^[a-z0-9][a-z0-9._-]{2,29}$/,
    "Choisissez un nom d’utilisateur de 3 à 30 caractères : lettres, chiffres, point, tiret ou underscore.",
  );
export const registrationSchema = memberDetailsSchema
  .extend({
    username: usernameSchema,
    password: z.string().min(12).max(128),
    confirmation: z.string(),
  })
  .refine((v) => v.password === v.confirmation, {
    path: ["confirmation"],
    message: "Les mots de passe ne correspondent pas.",
  });
export function accountEmail(username) {
  return `${username}@members.esms.invalid`;
}
