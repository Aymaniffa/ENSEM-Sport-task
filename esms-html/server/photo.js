import sharp from "sharp";
export async function normalizePhoto(file) {
  if (
    !["image/jpeg", "image/png", "image/webp"].includes(file.type) ||
    file.size === 0 ||
    file.size > 2 * 1024 * 1024
  )
    throw new Error("Choisissez une photo JPG, PNG ou WebP de 2 Mo maximum.");
  try {
    return await sharp(Buffer.from(await file.arrayBuffer()), {
      limitInputPixels: 20_000_000,
    })
      .rotate()
      .resize(320, 320, { fit: "cover" })
      .jpeg({ quality: 85 })
      .toBuffer();
  } catch {
    throw new Error("Cette image est illisible. Choisissez une autre photo.");
  }
}
