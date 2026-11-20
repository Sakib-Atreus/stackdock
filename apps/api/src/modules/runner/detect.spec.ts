import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DetectionError, detectRuntime, planBuild } from './detect.js';

const AUTO = {
  runtime: 'AUTO' as const,
  installCommand: null,
  buildCommand: null,
  startCommand: null,
};

describe('runtime detection and build plans', () => {
  let dir: string;
  const write = (file: string, content = '') => {
    mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    writeFileSync(path.join(dir, file), content);
  };

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'detect-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('detects nothing in an empty folder and explains', () => {
    expect(detectRuntime(dir)).toBeNull();
    expect(() => planBuild(dir, AUTO)).toThrow(DetectionError);
  });

  it('Node with npm lockfile, build and start scripts', () => {
    write(
      'package.json',
      JSON.stringify({ scripts: { build: 'tsc', start: 'node dist' } }),
    );
    write('package-lock.json', '{}');
    expect(planBuild(dir, AUTO)).toMatchObject({
      runtime: 'NODE',
      install: 'npm ci',
      build: 'npm run build',
      start: 'npm start',
    });
  });

  it('Node with pnpm and no start script falls back to server.js', () => {
    write('package.json', '{}');
    write('pnpm-lock.yaml');
    write('server.js');
    expect(planBuild(dir, AUTO)).toMatchObject({
      install: 'pnpm install --frozen-lockfile',
      build: null,
      start: 'node server.js',
    });
  });

  it('Node without any start target asks for a start command', () => {
    write('package.json', '{}');
    expect(() => planBuild(dir, AUTO)).toThrow(/start command/);
  });

  it('Python with gunicorn', () => {
    write('requirements.txt', 'flask\ngunicorn==22\n');
    write('app.py');
    expect(planBuild(dir, AUTO)).toMatchObject({
      runtime: 'PYTHON',
      start: 'gunicorn --bind 127.0.0.1:$PORT app:app',
    });
  });

  it('Python with uvicorn and main.py', () => {
    write('requirements.txt', 'fastapi\nuvicorn\n');
    write('main.py');
    expect(planBuild(dir, AUTO).start).toBe(
      'uvicorn main:app --host 127.0.0.1 --port $PORT',
    );
  });

  it('plain Python script', () => {
    write('requirements.txt', '');
    write('server.py');
    const plan = planBuild(dir, AUTO);
    expect(plan.start).toBe('python server.py');
    expect(plan.pathPrefix[0]).toContain('.venv');
  });

  it('Go', () => {
    write('go.mod', 'module x');
    expect(planBuild(dir, AUTO)).toMatchObject({
      runtime: 'GO',
      build: 'go build -o ./.stackdock/bin/app .',
      start: './.stackdock/bin/app',
    });
  });

  it('PHP with composer and public/', () => {
    write('composer.json', '{}');
    write('public/index.php');
    expect(planBuild(dir, AUTO)).toMatchObject({
      runtime: 'PHP',
      start: 'php -S 127.0.0.1:$PORT -t public',
    });
  });

  it('uses the Procfile web command when no start command is set', () => {
    write('requirements.txt', 'django\ngunicorn\n');
    write(
      'Procfile',
      'release: ./manage.py migrate\nweb: gunicorn --config gunicorn.conf.py gettingstarted.wsgi\n',
    );
    const plan = planBuild(dir, AUTO);
    expect(plan.start).toBe(
      'gunicorn --config gunicorn.conf.py gettingstarted.wsgi',
    );
    expect(plan.notes.join()).toContain('Procfile');
  });

  it('runs collectstatic for Django projects', () => {
    write('requirements.txt', 'django\n');
    write('manage.py');
    write('Procfile', 'web: gunicorn x.wsgi');
    expect(planBuild(dir, AUTO).build).toBe(
      'python manage.py collectstatic --noinput',
    );
  });

  it('ignores Heroku-only Procfile commands', () => {
    write('composer.json', '{}');
    write('web/index.php');
    write('Procfile', 'web: heroku-php-apache2 web/');
    expect(planBuild(dir, AUTO)).toMatchObject({
      runtime: 'PHP',
      start: 'php -S 127.0.0.1:$PORT -t web',
    });
  });

  it("ignores a Go Procfile (it names Heroku's build output)", () => {
    write('go.mod', 'module example.com/go-getting-started');
    write('Procfile', 'web: go-getting-started');
    expect(planBuild(dir, AUTO).start).toBe('./.stackdock/bin/app');
  });

  it('a project start command beats the Procfile', () => {
    write('package.json', '{}');
    write('Procfile', 'web: node a.js');
    expect(planBuild(dir, { ...AUTO, startCommand: 'node b.js' }).start).toBe(
      'node b.js',
    );
  });

  it('user commands and an explicit runtime override detection', () => {
    write('package.json', '{}');
    expect(
      planBuild(dir, {
        runtime: 'NODE',
        installCommand: 'npm install --omit=dev',
        buildCommand: null,
        startCommand: 'node app.mjs',
      }),
    ).toMatchObject({
      install: 'npm install --omit=dev',
      start: 'node app.mjs',
    });
  });
});
