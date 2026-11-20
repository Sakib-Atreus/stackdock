import { projectSlugSchema } from './project-slug.js';

describe('projectSlugSchema', () => {
  it.each(['a', 'shop', 'my-api', 'app1', 'a-b-c', 'abcdefgh'])(
    'accepts %s',
    (slug) => {
      expect(projectSlugSchema.safeParse(slug).success).toBe(true);
    },
  );

  it.each([
    ['', 'empty'],
    ['abcdefghi', 'longer than 8'],
    ['1app', 'starts with a digit'],
    ['-app', 'starts with a hyphen'],
    ['app-', 'ends with a hyphen'],
    ['my--api', 'double hyphen'],
    ['Shop', 'uppercase'],
    ['my_api', 'underscore'],
    ['dash', 'reserved'],
    ['api', 'reserved'],
  ])('rejects %s (%s)', (slug) => {
    expect(projectSlugSchema.safeParse(slug).success).toBe(false);
  });
});
