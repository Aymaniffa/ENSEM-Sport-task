// Read ordered pages to avoid Supabase's default 1,000-row response limit.
export async function allRows(page) {
  const rows = [];
  const size = 500;
  for (let from = 0; ; from += size) {
    const result = await page(from, from + size - 1);
    if (result.error) return { data: null, error: result.error };
    rows.push(...(result.data ?? []));
    if (!result.data || result.data.length < size)
      return { data: rows, error: null };
  }
}
