export function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

// Months (inclusive) spanning [start, end], each as {y, m} (m is 1-based).
export function monthsBetween(start: string, end: string): { y: number; m: number }[] {
  const [sy, sm] = start.split('-').map(Number);
  const [ey, em] = end.split('-').map(Number);
  const out: { y: number; m: number }[] = [];
  let y = sy;
  let m = sm;
  while (y < ey || (y === ey && m <= em)) {
    out.push({ y, m });
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

// Calendar cells for a month: leading nulls to align day 1 to its weekday, then
// one 'YYYY-MM-DD' per day. UTC math avoids local-tz drift in the grid layout.
export function monthCells(y: number, m: number): (string | null)[] {
  const firstWeekday = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const cells: (string | null)[] = [];
  for (let i = 0; i < firstWeekday; i += 1) {
    cells.push(null);
  }
  for (let d = 1; d <= daysInMonth; d += 1) {
    cells.push(`${y}-${pad2(m)}-${pad2(d)}`);
  }
  return cells;
}

export function monthLabel(y: number, m: number): string {
  const label = new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('pt-BR', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
  return label.charAt(0).toUpperCase() + label.slice(1);
}
