export function parseRange(start: number, end: number): [number, number] {
  if (start < 0 || end < start) throw new Error("invalid range");
  return [start, end];
}
