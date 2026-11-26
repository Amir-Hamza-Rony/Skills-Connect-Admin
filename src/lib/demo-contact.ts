/**
 * Generate a demo placeholder contact email from a name.
 * e.g. "John Doe" → "johndoe@example.com"; fallback "contact1@example.com".
 */
export function generateDemoContact(name: string, fallback = "contact"): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .slice(0, 30) || fallback;
  return `${base}@example.com`;
}
