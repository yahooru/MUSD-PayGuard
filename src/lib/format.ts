/** Presentation helpers. No business logic here. */

/** Split an address/hash into 4-character groups after the 0x prefix for readability. */
export function groupHex(value: string, size = 4): string[] {
  const has0x = value.startsWith("0x") || value.startsWith("0X");
  const body = has0x ? value.slice(2) : value;
  const groups: string[] = [];
  for (let i = 0; i < body.length; i += size) groups.push(body.slice(i, i + size));
  return has0x ? ["0x", ...groups] : groups;
}

export function shortAddress(address: string | null | undefined, lead = 6, tail = 4): string {
  if (!address) return "";
  if (address.length <= lead + tail + 2) return address;
  return `${address.slice(0, lead)}…${address.slice(-tail)}`;
}

export function shortHash(hash: string | null | undefined): string {
  return shortAddress(hash, 10, 6);
}

const dateTime = new Intl.DateTimeFormat("en-GB", {
  year: "numeric",
  month: "short",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "UTC",
});

export function formatDateTime(value: string | number | Date | null | undefined): string {
  if (value == null) return "—";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return `${dateTime.format(d)} UTC`;
}

const dateOnly = new Intl.DateTimeFormat("en-GB", { year: "numeric", month: "short", day: "2-digit", timeZone: "UTC" });
export function formatDate(value: string | number | Date | null | undefined): string {
  if (value == null) return "—";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return dateOnly.format(d);
}

export function relativeTime(value: string | number | Date, now = Date.now()): string {
  const t = value instanceof Date ? value.getTime() : new Date(value).getTime();
  const diff = Math.round((now - t) / 1000);
  const abs = Math.abs(diff);
  const suffix = diff >= 0 ? "ago" : "from now";
  if (abs < 45) return diff >= 0 ? "just now" : "in a few seconds";
  if (abs < 90) return `1 minute ${suffix}`;
  if (abs < 3600) return `${Math.round(abs / 60)} minutes ${suffix}`;
  if (abs < 5400) return `1 hour ${suffix}`;
  if (abs < 86400) return `${Math.round(abs / 3600)} hours ${suffix}`;
  if (abs < 172800) return diff >= 0 ? "yesterday" : "tomorrow";
  return `${Math.round(abs / 86400)} days ${suffix}`;
}

export function formatGas(value: bigint | number | string): string {
  return BigInt(value).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

export function pluralize(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}
