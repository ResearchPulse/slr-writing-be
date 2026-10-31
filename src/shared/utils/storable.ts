// PostgreSQL text and JSON columns cannot hold a NUL, and a lone surrogate cannot be encoded as UTF-8.
// Either one makes the whole write fail with a 500, so reject them at the edge with a 400.
const UNSTORABLE = /\u0000|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

export const hasUnstorableText = (value: string): boolean => UNSTORABLE.test(value);
