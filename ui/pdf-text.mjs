/** Join PDF text runs using their positions, rather than treating runs as words. */
export function assemblePdfText(items) {
  let result = "",
    previous = null;
  for (const item of items) {
    if (typeof item.str !== "string") continue; // Marked-content entries are not text.
    const text = item.str;
    if (!text) {
      if (item.hasEOL && !result.endsWith("\n")) result += "\n";
      continue;
    }
    if (previous && result && !/\s$/.test(result) && !/^\s/.test(text)) {
      const a = previous.transform,
        b = item.transform;
      if (a && b) {
        const scale = Math.hypot(a[0], a[1]) || 1;
        const ux = a[0] / scale,
          uy = a[1] / scale;
        const dx = b[4] - a[4],
          dy = b[5] - a[5];
        const height = Math.min(
          Math.hypot(a[2], a[3]) || scale,
          Math.hypot(b[2], b[3]) || scale,
        );
        const direction = previous.dir === "rtl" ? -1 : 1;
        const advance = (dx * ux + dy * uy) * direction;
        const gap = advance - (previous.width || 0);
        const lineChange =
          Math.abs(-dx * uy + dy * ux) > height * 0.4 ||
          advance < -height * 0.5;
        if (lineChange) result += "\n";
        else if (gap > height * 0.12) result += " ";
      }
    }
    result += text;
    if (item.hasEOL && !result.endsWith("\n")) result += "\n";
    previous = item;
  }
  return result.replace(/[\t ]+\n/g, "\n").trim();
}

/** Locate the same quote characters in repaired source text; change whitespace only. */
export function reconcileQuote(text, source) {
  const compact = (s) => s.replace(/\s/gu, "");
  const target = compact(text);
  if (!target) return null;
  const offsets = [];
  let normalized = "";
  for (let i = 0; i < source.length; i++)
    if (!/\s/u.test(source[i])) {
      normalized += source[i];
      offsets.push(i);
    }
  const index = normalized.indexOf(target);
  return index < 0
    ? null
    : source.slice(offsets[index], offsets[index + target.length - 1] + 1);
}
