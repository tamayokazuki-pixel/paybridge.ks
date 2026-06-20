export function money(value: number | null | undefined) {
  return `$${Number(value || 0).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`;
}

export function initials(first?: string | null, last?: string | null) {
  return `${first?.[0] || "T"}${last?.[0] || "W"}`.toUpperCase();
}
