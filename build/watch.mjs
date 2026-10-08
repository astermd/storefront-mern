// Dev watcher: re-runs the asset build whenever the theme changes, so an edit
// to a template or a CSS/JS source file needs no manual rebuild.
//
// It watches `views/` as well as `public/css` and `public/js` — not obvious,
// but load-bearing: Tailwind's `@source` directives in public/css/app.css
// scan `views/` for class names actually used, so a class used for the first
// time in an .ejs file has to trigger a CSS rebuild or the markup ships
// referring to a rule that was never compiled.
//
// Not a bundler and not a dev server. The build is the same one `npm run
// build:assets` runs, so what's previewed here is what gets committed.
import { execFileSync } from 'node:child_process';
import { watch } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const WATCHED = ['public/css', 'public/js', 'views'];

// A single save can surface as several events (write, truncate, rename), and
// editors that write atomically produce a rename plus a create. Rebuilding on
// each would run the build three times for one keystroke, so events inside
// this window collapse into one run.
const DEBOUNCE_MS = 80;

let queued = null;
let building = false;

function build(reason) {
  if (building) return;
  building = true;
  const started = Date.now();
  try {
    execFileSync('node', [join(root, 'build/build-assets.mjs')], { cwd: root, stdio: 'pipe' });
    console.log(`rebuilt in ${Date.now() - started}ms  (${reason})`);
  } catch (error) {
    // Stay alive. A broken @source or a half-written file is something to fix
    // on the next save, and an exit here would mean restarting the watcher.
    console.error(`build failed  (${reason})\n${error.stderr?.toString() ?? error.message}`);
  } finally {
    building = false;
  }
}

function schedule(reason) {
  clearTimeout(queued);
  queued = setTimeout(() => build(reason), DEBOUNCE_MS);
}

for (const dir of WATCHED) {
  watch(join(root, dir), { recursive: true }, (_event, file) => {
    // Editor scratch files: vim's 4913, JetBrains' ___jb_tmp___, and the
    // dotfile swap files most editors leave behind mid-save.
    if (!file || /(^|\/)\.|~$|\.sw[px]$|___jb_/.test(file)) return;
    schedule(`${dir}/${file}`);
  });
}

console.log(`watching ${WATCHED.join(', ')} — ctrl-c to stop`);
build('initial');
