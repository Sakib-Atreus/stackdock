const MASK = '••••';
/** Shorter values (e.g. "1", "true") are too common to redact safely. */
const MIN_SECRET_LENGTH = 6;

/** Replaces every occurrence of known secret values in log text. */
export class Redactor {
  private readonly secrets: string[];

  constructor(values: Iterable<string>) {
    this.secrets = [...new Set(values)]
      .filter((v) => v.length >= MIN_SECRET_LENGTH)
      // Longest first, so a secret containing another is fully masked.
      .sort((a, b) => b.length - a.length);
  }

  redact(text: string): string {
    let out = text;
    for (const secret of this.secrets) {
      if (out.includes(secret)) out = out.split(secret).join(MASK);
    }
    return out;
  }
}
