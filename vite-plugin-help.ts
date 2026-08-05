import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { marked } from 'marked';
import type { Plugin } from 'vite';

// ─────────────────────────────────────────────────────────────────────────────
//  Build-time help renderer.
//
//  Turns docs/wiki/*.md into pre-rendered HTML inside a virtual module, so the
//  app can show its own documentation with NO markdown parser in the shipped
//  bundle and no network access. A booth machine may have no route to the
//  internet — which is exactly when someone needs the page explaining why
//  Smaart is showing no SPL.
//
//  `marked` is a devDependency and is never shipped: it runs here, at build
//  time, and only its OUTPUT reaches the browser. The consumer imports this
//  module dynamically, so the HTML lands in its own lazy chunk and costs the
//  main bundle nothing until someone opens Help.
//
//  Same source files as the public site (docs/wiki), so the two cannot drift.
// ─────────────────────────────────────────────────────────────────────────────

const VIRTUAL_ID = 'virtual:help-content';
const RESOLVED_ID = `\0${VIRTUAL_ID}`;

/** Reading order, not alphabetical — install before you configure. */
const ORDER = [
  'index',
  'Installation',
  'First-Run-Setup',
  'Run-of-Show',
  'Dashboards-and-Displays',
  'Checklists',
  'Rooms-and-Campuses',
  'User-Management',
  'Integrations',
  'Integration-Caveats',
];

const TITLES: Record<string, string> = {
  index: 'Overview',
  'Installation': 'Installation',
  'First-Run-Setup': 'First-run setup',
  'Run-of-Show': 'Run of Show',
  'Dashboards-and-Displays': 'Dashboards & displays',
  'Checklists': 'Checklists',
  'Rooms-and-Campuses': 'Rooms & campuses',
  'User-Management': 'Users & access',
  'Integrations': 'Integrations',
  'Integration-Caveats': 'Integration caveats',
};

export interface HelpPage {
  slug: string;
  title: string;
  html: string;
  /** Lowercased text, for the drawer's filter. Built here so the browser
   *  never has to strip tags from every page to search them. */
  text: string;
}

function build(docsDir: string): HelpPage[] {
  // A missing directory surfaces from the bundler as a bare ENOENT on scandir,
  // which says nothing about why. It has one real cause: a build context that
  // excluded docs/ — the Docker build did exactly that until .dockerignore
  // learned to keep the guide.
  if (!existsSync(docsDir)) {
    throw new Error(
      `Help content not found at ${docsDir}. The guide is a BUILD INPUT, not `
      + 'documentation — check that docs/wiki is present in the build context '
      + '(see .dockerignore).',
    );
  }

  const present = new Set(
    readdirSync(docsDir).filter((f) => f.endsWith('.md')).map((f) => f.replace(/\.md$/, '')),
  );
  const slugs = [
    ...ORDER.filter((s) => present.has(s)),
    ...[...present].filter((s) => !ORDER.includes(s)).sort(),
  ];

  return slugs.map((slug) => {
    let md = readFileSync(join(docsDir, `${slug}.md`), 'utf8');

    // Cross-page links point at other slugs, not at files on a web server.
    // Rewritten to an in-app anchor the drawer intercepts.
    md = md.replace(/\]\((?!https?:)([A-Za-z-]+)\.md(#[\w-]*)?\)/g, (_m, page, hash) =>
      `](#help/${page === 'index' ? 'index' : page}${hash ?? ''})`,
    );

    const html = marked.parse(md, { async: false }) as string;
    return {
      slug,
      title: TITLES[slug] ?? slug.replace(/-/g, ' '),
      html,
      text: html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').toLowerCase(),
    };
  });
}

export function helpContent(docsDir: string): Plugin {
  return {
    name: 'prodmesh-help-content',

    resolveId: (id) => (id === VIRTUAL_ID ? RESOLVED_ID : null),

    load(id) {
      if (id !== RESOLVED_ID) return null;
      return `export default ${JSON.stringify(build(docsDir))};`;
    },

    // Editing a page updates the drawer without restarting the dev server.
    configureServer(server) {
      server.watcher.add(docsDir);
      server.watcher.on('change', (file) => {
        if (!file.startsWith(docsDir) || !file.endsWith('.md')) return;
        const mod = server.moduleGraph.getModuleById(RESOLVED_ID);
        if (mod) server.moduleGraph.invalidateModule(mod);
        server.ws.send({ type: 'full-reload' });
      });
    },
  };
}
