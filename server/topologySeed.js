// ─────────────────────────────────────────────────────────────────────────────
//  TOPOLOGY SEED  —  first-boot data for Admin-owned institution config.
//
//  This is the one-time seed for the sites / site_rooms / tiles tables (see
//  appConfig.js). It is a verbatim port of the frontend's former static
//  src/config/dashboard.config.ts. After the first boot the database owns the
//  topology (Admin → Campuses edits it); this file only matters for a fresh
//  install with an empty database.
// ─────────────────────────────────────────────────────────────────────────────

export const seedChurch = {
  name: 'Production Dashboard',

  sites: [
    // ── NORTH (active) ───────────────────────────────────────────────────
    {
      id: 'north',
      name: 'North',
      status: 'active',
      auditoriums: [
        {
          id: 'north-main',
          name: 'Main Auditorium',
          tiles: [
            // Room control + Companion
            {
              id: 'north-main-status',
              type: 'route',
              label: 'Room Status',
              note: 'Mode control · Sunday / Mid-Week / Event',
              to: '/room/north-main',
            },
            {
              id: 'north-main-companion',
              type: 'companion',
              label: 'Companion',
              note: 'on Producer · :8000',
              host: '192.0.2.31',
            },
            // Macs → Screen Sharing (username prefilled)
            {
              id: 'north-main-producer',
              type: 'screenshare',
              label: 'Producer',
              note: 'Mac · Screen Sharing',
              icon: '🎛️',
              host: '192.0.2.31',
              username: 'producer',
            },
            {
              id: 'north-main-foh-lighting',
              type: 'screenshare',
              label: 'FOH Lighting',
              note: 'Mac · Screen Sharing',
              icon: '🎚️',
              host: '192.0.2.72',
              username: 'foh-lighting',
            },
            {
              id: 'north-main-resolume',
              type: 'screenshare',
              label: 'Graphics',
              note: 'Mac · Screen Sharing',
              icon: '🎬',
              host: '192.0.2.73',
              username: 'graphics',
            },
            {
              id: 'north-main-propresenter',
              type: 'screenshare',
              label: 'ProPresenter',
              note: 'Mac · Screen Sharing',
              icon: '📖',
              host: '192.0.2.74',
              username: 'propresenter',
            },
            // HTTP devices → web UI
            {
              id: 'north-main-hyperdeck1',
              type: 'link',
              label: 'Hyperdeck 1',
              note: 'Blackmagic · HTTP/FTP',
              icon: '⏺️',
              url: 'http://192.0.2.41',
            },
            {
              id: 'north-main-grandma3',
              type: 'link',
              label: 'GrandMA3',
              note: 'MA3 Remote · HTTP',
              icon: '💡',
              url: 'http://192.0.2.62',
            },
            {
              id: 'north-main-codecommander',
              type: 'link',
              label: 'CodeCommander',
              note: 'HTTP · MIDI Timecode',
              icon: '⏱️',
              url: 'http://192.0.2.91',
            },
            {
              id: 'north-main-clearcom',
              type: 'link',
              label: 'ClearCom',
              note: 'Comms · HTTP',
              icon: '🎧',
              url: 'http://192.0.2.99',
            },
            {
              id: 'north-main-cam9',
              type: 'link',
              label: 'Camera 9 PTZ',
              note: 'HTTP · Canon XC',
              icon: '📷',
              url: 'http://192.0.2.129',
            },
            {
              id: 'north-main-cam10',
              type: 'link',
              label: 'Camera 10 PTZ',
              note: 'HTTP · Canon XC',
              icon: '📷',
              url: 'http://192.0.2.130',
            },
          ],
        },
        {
          id: 'north-youth',
          name: 'Youth',
          tiles: [
            {
              id: 'north-youth-status',
              type: 'route',
              label: 'Room Status',
              note: 'Mode control · Sunday / Mid-Week / Event',
              to: '/room/north-youth',
            },
            {
              id: 'north-youth-companion',
              type: 'companion',
              label: 'Companion',
              note: 'on Lighting Mac · :8000',
              host: '192.0.2.150',
            },
            {
              id: 'north-youth-lighting',
              type: 'screenshare',
              label: 'Lighting',
              note: 'Mac · Screen Sharing',
              icon: '🎚️',
              host: '192.0.2.150',
              username: 'youth-lighting',
            },
            {
              id: 'north-youth-propresenter',
              type: 'placeholder',
              label: 'ProPresenter',
              note: 'Mac · IP TBD',
              icon: '📖',
            },
          ],
        },
        {
          id: 'north-chapel',
          name: 'Chapel',
          tiles: [
            {
              id: 'north-chapel-status',
              type: 'route',
              label: 'Room Status',
              note: 'Mode control · Sunday / Mid-Week / Event',
              to: '/room/north-chapel',
            },
            {
              id: 'north-chapel-companion',
              type: 'companion',
              label: 'Companion',
              note: 'on Chapel ProPresenter · :8000',
              host: '192.0.2.101',
            },
            {
              id: 'north-chapel-lighting',
              type: 'screenshare',
              label: 'Lighting',
              note: 'Mac · Screen Sharing',
              icon: '🎚️',
              host: '192.0.2.102',
              username: 'chapel-production',
            },
            {
              id: 'north-chapel-propresenter',
              type: 'screenshare',
              label: 'Chapel ProPresenter',
              note: 'Mac · Screen Sharing',
              icon: '📖',
              host: '192.0.2.101',
              username: 'chapel-propresenter',
            },
          ],
        },
        {
          id: 'north-kids',
          name: 'Elementary Chapel',
          tiles: [
            {
              id: 'north-kids-tbd',
              type: 'placeholder',
              label: 'No devices yet',
              note: 'Add tiles when configured',
            },
          ],
        },
      ],
    },

    // ── SOUTH EVERETT (opens December 2026) ────────────────────────────────
    // Scaffolded now so the layout is ready. Swap placeholders + flip status to
    // 'active' when the site comes online.
    {
      id: 'south-everett',
      name: 'South Campus',
      status: 'coming-soon', // opens December 2026
      auditoriums: [
        {
          id: 'south-main',
          name: 'Main',
          tiles: [
            { id: 'south-main-companion', type: 'placeholder', label: 'Companion', note: 'Not yet configured' },
            { id: 'south-main-prod-pc', type: 'placeholder', label: 'Production Mac', note: 'Not yet configured' },
          ],
        },
        {
          id: 'south-youth',
          name: 'Youth',
          tiles: [
            { id: 'south-youth-companion', type: 'placeholder', label: 'Companion', note: 'Not yet configured' },
          ],
        },
        {
          id: 'south-chapel',
          name: 'Chapel',
          tiles: [
            { id: 'south-chapel-companion', type: 'placeholder', label: 'Companion', note: 'Not yet configured' },
          ],
        },
        {
          id: 'south-kids',
          name: 'Elementary Chapel',
          tiles: [
            { id: 'south-kids-companion', type: 'placeholder', label: 'Companion', note: 'Not yet configured' },
          ],
        },
      ],
    },
  ],
};
