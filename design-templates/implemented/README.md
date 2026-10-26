# Implemented light editorial screens

Browser captures from the local implementation, using isolated synthetic data. These records were never added to the real workspace.

- `positions.png`: positions grid with search, department filter, status tabs and sorting.
- `comparison.png`: candidate comparison with the full eight-criterion synthetic rubric.
- `evidence.png`: full-page evidence and rubric layout with coverage banner.

Checked at the browser's desktop viewport and at 390 × 844. Comparison tables scroll within their containers on mobile; the page itself does not overflow horizontally.

The real app remains available through the normal local server at http://127.0.0.1:4183. Node 22.16+ is required by the project. The development session used the bundled Node 24 runtime because the shell's default Node is 20.
