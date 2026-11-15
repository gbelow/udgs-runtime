// A markdown table whose columns line up in the file as well as when shown:
// every cell padded to its column's width, numbers to the right.

export type Align = 'left' | 'right'

export function formatTable(headers: string[], rows: (string | number)[][], align: Align[] = []): string {
  const cells = rows.map((row) => row.map((cell) => String(cell)))
  const widths = headers.map((h, i) => Math.max(3, h.length, ...cells.map((row) => (row[i] ?? '').length)))
  const pad = (text: string, i: number) => (align[i] === 'right' ? text.padStart(widths[i]) : text.padEnd(widths[i]))
  const line = (row: string[]) => `| ${row.map((cell, i) => pad(cell, i)).join(' | ')} |`
  const rule = `| ${widths.map((w, i) => (align[i] === 'right' ? `${'-'.repeat(w - 1)}:` : '-'.repeat(w))).join(' | ')} |`
  return [line(headers), rule, ...cells.map(line)].join('\n')
}
