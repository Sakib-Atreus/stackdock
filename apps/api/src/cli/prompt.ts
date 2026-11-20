import { createInterface } from 'node:readline';

/** Asks a question on the terminal. With `hidden`, typed characters aren't echoed. */
export function prompt(question: string, hidden = false): Promise<string> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
  });
  if (hidden) {
    // Echo nothing while the user types (keeps the password off the screen).
    (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput =
      (s: string) => {
        if (s.startsWith(question)) process.stdout.write(question);
      };
  }
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      if (hidden) process.stdout.write('\n');
      resolve(answer);
    });
  });
}
