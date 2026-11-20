import { z } from 'zod';

/**
 * A project slug doubles as the Northflank public port name (see docs/decisions.md D-15),
 * so it must satisfy Northflank's port-name rules: 1–8 chars, starts with a letter,
 * letters/digits separated by single hyphens.
 *
 * We additionally force lowercase so URLs are predictable.
 */
export const PROJECT_SLUG_MAX_LENGTH = 8;

export const PROJECT_SLUG_PATTERN = /^[a-z](-?[a-z0-9]+(-[a-z0-9]+)*)?$/;

/** Slugs StackDock uses itself and that projects therefore cannot take. */
export const RESERVED_PROJECT_SLUGS = ['dash', 'api', 'apps', 'admin'] as const;

export const projectSlugSchema = z
  .string()
  .min(1, 'Name is required')
  .max(PROJECT_SLUG_MAX_LENGTH, `Max ${PROJECT_SLUG_MAX_LENGTH} characters`)
  .regex(
    PROJECT_SLUG_PATTERN,
    'Use lowercase letters, digits and single hyphens; start with a letter',
  )
  .refine(
    (slug) => !(RESERVED_PROJECT_SLUGS as readonly string[]).includes(slug),
    'This name is reserved',
  );
