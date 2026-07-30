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
    // ── north (active) ───────────────────────────────────────────────────
    {
      id: 'north',
      name: 'North Campus',
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
              note: 'on the Producer Mac · :8000',
              host: '192.0.2.10',
            },
            // Macs → Screen Sharing (username prefilled)
            {
              id: 'north-main-producer',
              type: 'screenshare',
              label: 'Producer Mac',
              note: 'Mac · Screen Sharing',
              icon: '🎛️',
              host: '192.0.2.10',
              username: 'producer',
            },
            {
              id: 'north-main-foh-lighting',
              type: 'screenshare',
              label: 'Lighting Mac',
              note: 'Mac · Screen Sharing',
              icon: '🎚️',
              host: '192.0.2.13',
              username: 'lighting',
            },
            {
              id: 'north-main-resolume',
              type: 'screenshare',
              label: 'Media Server',
              note: 'Mac · Screen Sharing',
              icon: '🎬',
              host: '192.0.2.14',
              username: 'media',
            },
            {
              id: 'north-main-propresenter',
              type: 'screenshare',
              label: 'ProPresenter Mac',
              note: 'Mac · Screen Sharing',
              icon: '📖',
              host: '192.0.2.15',
              username: 'presentation',
            },
            // HTTP devices → web UI
            {
              id: 'north-main-hyperdeck1',
              type: 'link',
              label: 'Hyperdeck 1',
              note: 'Blackmagic · HTTP/FTP',
              icon: '⏺️',
              url: 'http://192.0.2.11',
            },
            {
              id: 'north-main-grandma3',
              type: 'link',
              label: 'GrandMA3',
              note: 'MA3 Remote · HTTP',
              icon: '💡',
              url: 'http://192.0.2.12',
            },
            {
              id: 'north-main-codecommander',
              type: 'link',
              label: 'CodeCommander',
              note: 'HTTP · MIDI Timecode',
              icon: '⏱️',
              url: 'http://192.0.2.16',
            },
            {
              id: 'north-main-clearcom',
              type: 'link',
              label: 'ClearCom',
              note: 'Comms · HTTP',
              icon: '🎧',
              url: 'http://192.0.2.17',
            },
            {
              id: 'north-main-cam9',
              type: 'link',
              label: 'Camera 9 PTZ',
              note: 'HTTP · Canon XC',
              icon: '📷',
              url: 'http://192.0.2.20',
            },
            {
              id: 'north-main-cam10',
              type: 'link',
              label: 'Camera 10 PTZ',
              note: 'HTTP · Canon XC',
              icon: '📷',
              url: 'http://192.0.2.21',
            },
          ],
        },
        {
          id: 'north-youth',
          name: 'Youth Room',
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
              host: '192.0.2.22',
            },
            {
              id: 'north-youth-lighting',
              type: 'screenshare',
              label: 'Lighting',
              note: 'Mac · Screen Sharing',
              icon: '🎚️',
              host: '192.0.2.22',
              username: 'youthlights',
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
              host: '192.0.2.18',
            },
            {
              id: 'north-chapel-lighting',
              type: 'screenshare',
              label: 'Lighting',
              note: 'Mac · Screen Sharing',
              icon: '🎚️',
              host: '192.0.2.19',
              username: 'chapelav',
            },
            {
              id: 'north-chapel-propresenter',
              type: 'screenshare',
              label: 'Chapel ProPresenter',
              note: 'Mac · Screen Sharing',
              icon: '📖',
              host: '192.0.2.18',
              username: 'chapelpresentation',
            },
          ],
        },
        {
          id: 'north-kids',
          name: 'Kids Room',
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

    // ── SOUTH CAMPUS (opens December 2026) ────────────────────────────────
    // Scaffolded now so the layout is ready. Swap placeholders + flip status to
    // 'active' when the site comes online.
    {
      id: 'south',
      name: 'South Campus',
      status: 'disabled', // opens December 2026
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
          name: 'Youth Room',
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
          name: 'Kids Room',
          tiles: [
            { id: 'south-kids-companion', type: 'placeholder', label: 'Companion', note: 'Not yet configured' },
          ],
        },
      ],
    },
  ],
};
