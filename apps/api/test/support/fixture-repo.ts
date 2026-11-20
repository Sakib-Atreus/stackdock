import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

/** A throwaway local git repository used as a project source (file://). */
export class FixtureRepo {
  readonly dir: string;

  constructor(files: Record<string, string>) {
    this.dir = mkdtempSync(path.join(tmpdir(), 'stackdock-fixture-'));
    this.git('init', '-q', '-b', 'main');
    this.git('config', 'user.email', 'test@example.com');
    this.git('config', 'user.name', 'Test');
    this.commit(files, 'initial');
  }

  get url(): string {
    return `file://${this.dir}`;
  }

  commit(files: Record<string, string>, message: string): void {
    for (const [file, content] of Object.entries(files)) {
      const full = path.join(this.dir, file);
      mkdirSync(path.dirname(full), { recursive: true });
      writeFileSync(full, content);
    }
    this.git('add', '-A');
    this.git('commit', '-q', '-m', message);
  }

  remove(): void {
    rmSync(this.dir, { recursive: true, force: true });
  }

  private git(...args: string[]): void {
    execFileSync('git', args, { cwd: this.dir, stdio: 'pipe' });
  }
}

/**
 * Tiny Node app (no dependencies). Endpoints:
 *  /health   → 200
 *  /         → version + env facts (never secret values)
 *  /echo     → request headers it received (to check cookie stripping)
 *  /crash    → exits with code 1
 * Prints SECRET_TOKEN at startup so we can check log redaction.
 */
export function nodeApp(version: string): Record<string, string> {
  return {
    'package.json': JSON.stringify({
      name: 'fixture',
      version: '1.0.0',
      scripts: { build: 'node build.js', start: 'node server.js' },
    }),
    'build.js': `require('fs').writeFileSync('built.txt', 'built ${version}'); console.log('build ok');`,
    'server.js': `
const http = require('http');
const fs = require('fs');
console.log('starting with token ' + (process.env.SECRET_TOKEN || 'none'));
http.createServer((req, res) => {
  if (req.url === '/health') return res.end('ok');
  if (req.url === '/crash') { res.end('bye'); setTimeout(() => process.exit(1), 10); return; }
  if (req.url === '/echo') { res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify(req.headers)); }
  if (req.url === '/setcookie') {
    res.setHeader('set-cookie', ['sd_session=hijack; Path=/', 'app_cookie=1; Path=/']);
    return res.end('ok');
  }
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify({
    version: ${JSON.stringify(version)},
    built: fs.existsSync('built.txt') ? fs.readFileSync('built.txt', 'utf8') : null,
    path: req.url,
    hasSessionSecret: process.env.SESSION_SECRET !== undefined,
    hasEncryptionKey: process.env.CREDENTIAL_ENCRYPTION_KEY !== undefined,
    hasDatabaseUrl: process.env.DATABASE_URL !== undefined,
    apiKey: process.env.API_KEY || null,
    basePath: process.env.BASE_PATH,
    nodeEnv: process.env.NODE_ENV,
  }));
}).listen(Number(process.env.PORT), '127.0.0.1');
`,
  };
}

export const pythonApp: Record<string, string> = {
  'requirements.txt': '',
  'app.py': `
import json, os
from http.server import BaseHTTPRequestHandler, HTTPServer

class H(BaseHTTPRequestHandler):
    def do_GET(self):
        body = json.dumps({"lang": "python", "path": self.path}).encode()
        self.send_response(200)
        self.send_header("content-type", "application/json")
        self.end_headers()
        self.wfile.write(body)
    def log_message(self, *args):
        pass

print("python up", flush=True)
HTTPServer(("127.0.0.1", int(os.environ["PORT"])), H).serve_forever()
`,
};

export const goApp: Record<string, string> = {
  'go.mod': 'module fixture\n\ngo 1.21\n',
  'main.go': `package main

import (
	"fmt"
	"net/http"
	"os"
)

func main() {
	http.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("content-type", "application/json")
		fmt.Fprintf(w, "{\\"lang\\":\\"go\\",\\"path\\":%q}", r.URL.Path)
	})
	fmt.Println("go up")
	http.ListenAndServe("127.0.0.1:"+os.Getenv("PORT"), nil)
}
`,
};

export const phpApp: Record<string, string> = {
  'public/index.php': `<?php header('content-type: application/json'); echo json_encode(['lang' => 'php', 'path' => $_SERVER['REQUEST_URI']]);`,
};
