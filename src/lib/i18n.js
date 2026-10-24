// Helpers for i18n JSONB columns shaped like {"en":"...","ta":"...","si":"..."}.

export function pickI18n(value, lang = 'en') {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value !== 'object') return '';
  return (
    value[lang] ||
    value.en ||
    value.ta ||
    value.si ||
    Object.values(value).find((v) => typeof v === 'string') ||
    ''
  );
}

export function altI18n(value) {
  const base = value && typeof value === 'object' ? value : {};
  return {
    en: typeof base.en === 'string' ? base.en : '',
    ta: typeof base.ta === 'string' ? base.ta : '',
    si: typeof base.si === 'string' ? base.si : '',
  };
}

// Prisma Decimal -> number (or undefined when null).
export function num(decimal) {
  if (decimal == null) return undefined;
  const n = Number(decimal);
  return Number.isFinite(n) ? n : undefined;
}

// Prisma @db.Date Date -> YYYY-MM-DD.
export function toDateOnly(date) {
  if (!date) return null;
  if (typeof date === 'string') return date.slice(0, 10);
  return date.toISOString().slice(0, 10);
}

// JSON-safe: Prisma BigInt columns throw on JSON.stringify.
export function jsonSafe(value) {
  return JSON.parse(
    JSON.stringify(value, (_key, v) => (typeof v === 'bigint' ? Number(v) : v)),
  );
}
