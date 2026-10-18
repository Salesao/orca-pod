// Turns a string into a URL slug: Latin letters and digits, separated by "-".
export function slugify(text) {
  if (typeof text !== 'string') throw new TypeError('slugify: text must be a string');
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
