// Stop the ESMS server before using this maintenance tool (single-process DB).
import { localDatabase, updateLocalPassword } from "../server/local-store.js";
import { usernameSchema } from "../server/registration.js";
async function main() {
  const [operation, rawUsername] = process.argv.slice(2);
  const username = usernameSchema.parse(rawUsername);
  if (!["promote", "reset-password"].includes(operation))
    throw new Error("Usage: local-admin.ts promote|reset-password username");
  const db = await localDatabase();
  try {
    const result = await db.query(
      "select id from public.profiles where username=$1",
      [username],
    );
    if (!result.rows[0])
      throw new Error(
        "Compte introuvable. Inscrivez-vous d’abord sur le site.",
      );
    if (operation === "promote")
      await db.query(
        "update public.profiles set role='admin',active=true where id=$1",
        [result.rows[0].id],
      );
    else {
      if (process.stdin.isTTY)
        throw new Error(
          "Fournissez le nouveau mot de passe par entrée standard, jamais comme argument.",
        );
      let password = "";
      for await (const chunk of process.stdin) password += chunk;
      password = password.replace(/[\r\n]+$/, "");
      if (password.length < 12 || password.length > 128)
        throw new Error("Mot de passe : 12 à 128 caractères.");
      await updateLocalPassword(result.rows[0].id, password);
    }
    console.log("Compte mis à jour.");
  } finally {
    await db.close();
  }
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
