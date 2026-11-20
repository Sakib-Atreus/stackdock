import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC = 'stackdock:isPublic';

/** Marks a route as reachable without a session. Use sparingly. */
export const Public = () => SetMetadata(IS_PUBLIC, true);
