const names = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base",
});
export function nextComparisonSort(current, key) {
  return {
    key,
    direction:
      current.key === key
        ? current.direction === "ascending"
          ? "descending"
          : "ascending"
        : key === "candidate"
          ? "ascending"
          : "descending",
  };
}
export function sortCandidates(
  candidates,
  { key = "overall", direction = "descending" } = {},
) {
  const score = (c) =>
    key === "overall"
      ? c.score
      : c.decisions.answers.find(
          (a) => a.name === key.slice("criterion:".length),
        )?.score;
  return [...candidates].sort((a, b) => {
    const compared =
      key === "candidate"
        ? names.compare(a.label, b.label)
        : (score(a) ?? -Infinity) - (score(b) ?? -Infinity);
    return (
      (direction === "ascending" ? 1 : -1) *
        (Number.isNaN(compared) ? 0 : compared) ||
      names.compare(a.label, b.label) ||
      a.id.localeCompare(b.id)
    );
  });
}
