import { Transform } from 'class-transformer';
import sanitizeHtml from 'sanitize-html';

/**
 * Strips all HTML/script tags from a string field before validation.
 * Apply to every free-text input that will be stored in the database and
 * later rendered in a UI — prevents stored XSS.
 *
 * Allows NO tags by default (allowedTags: []).
 * Only safe for plain-text fields; do NOT use on fields that intentionally
 * store markup (none exist in this project).
 */
export function StripTags(): PropertyDecorator {
  return Transform(({ value }: { value: unknown }) => {
    if (typeof value !== 'string') return value;
    return sanitizeHtml(value, { allowedTags: [], allowedAttributes: {} }).trim();
  });
}
