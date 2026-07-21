// Generates the reference backdrop set.
//
// Backdrops are scene art drawn in *world* coordinates — the same space the
// composer places characters in (a 400×300 panel, ground at y=300) — so the
// virtual camera (§6.2) zooms them along with the characters: "changing the
// scale at which characters and the background appear." The art extends well
// beyond the panel so an establishing shot, which pulls the camera back to
// roughly an 850×640 window, never runs off the edge of the scene.
//
// Deliberately drawn with thin strokes and pale fills so a black line-art
// character reads against them without fighting the halo (§6.1).
//
// Run:  node assets/backdrops/gen-backdrops.mjs

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

// World extent the art must cover to survive the widest pull-back.
const VIEW = { x: -360, y: -420, w: 1120, h: 780 };
const GROUND = 300; // world y of the ground characters stand on

const ink = '#3a3a3a';
const sky = '#e9f1fb';
const wall = '#f4efe3';

/** A big rectangle covering the whole scene, as a background wash. */
const wash = (fill) => `<rect x="${VIEW.x}" y="${VIEW.y}" width="${VIEW.w}" height="${VIEW.h}" fill="${fill}"/>`;

/** Ground plane from `top` down past the bottom of the scene. */
const ground = (top, fill) =>
  `<rect x="${VIEW.x}" y="${top}" width="${VIEW.w}" height="${VIEW.y + VIEW.h - top}" fill="${fill}"/>` +
  `<line x1="${VIEW.x}" y1="${top}" x2="${VIEW.x + VIEW.w}" y2="${top}" stroke="${ink}" stroke-width="1.5"/>`;

const scenes = {
  // An outdoor field: sky, a low horizon, a tree off to one side, a few clouds.
  field: [
    wash(sky),
    ground(248, '#e4efd6'),
    // sun
    `<circle cx="-150" cy="-210" r="34" fill="#fdf3c8" stroke="${ink}" stroke-width="1.5"/>`,
    // clouds
    `<g fill="#ffffff" stroke="${ink}" stroke-width="1.5">
       <path d="M120 -150 q-24 0 -24 18 q-24 2 -20 20 q4 14 24 12 h72 q22 2 22 -16 q0 -18 -22 -18 q-4 -18 -30 -16 q-10 -1 -22 0 z"/>
       <path d="M470 -230 q-20 0 -20 15 q-20 2 -16 17 q3 12 20 10 h60 q18 2 18 -13 q0 -15 -18 -15 q-4 -15 -25 -13 z"/>
     </g>`,
    // tree, planted behind where a character would stand
    `<g stroke="${ink}" stroke-width="3" fill="#dcebc6" stroke-linejoin="round">
       <rect x="486" y="150" width="16" height="100" rx="4" fill="#e7dcc4"/>
       <circle cx="494" cy="126" r="66"/>
       <circle cx="446" cy="150" r="44"/>
       <circle cx="542" cy="150" r="44"/>
     </g>`,
    // grass tufts along the horizon
    `<g stroke="#7f9e5c" stroke-width="2" fill="none" stroke-linecap="round">
       ${Array.from({ length: 24 }, (_, i) => {
         const x = VIEW.x + 40 + i * 44;
         return `<path d="M${x} 250 q3 -12 6 0 M${x + 6} 250 q3 -14 6 0 M${x + 12} 250 q3 -12 6 0"/>`;
       }).join('')}
     </g>`,
  ],

  // An interior room: papered wall, floor, a window and a hung picture.
  room: [
    wash(wall),
    ground(250, '#e8dfca'),
    // baseboard
    `<line x1="${VIEW.x}" y1="262" x2="${VIEW.x + VIEW.w}" y2="262" stroke="${ink}" stroke-width="1"/>`,
    // window with muntins and pale panes
    `<g stroke="${ink}" stroke-width="3" fill="#dbe9f7">
       <rect x="34" y="70" width="120" height="120" rx="3" fill="#dbe9f7"/>
       <line x1="94" y1="70" x2="94" y2="190"/>
       <line x1="34" y1="130" x2="154" y2="130"/>
       <rect x="26" y="192" width="136" height="8" fill="#efe8d8"/>
     </g>`,
    // framed picture
    `<g stroke="${ink}" stroke-width="3" fill="#ffffff">
       <rect x="306" y="86" width="96" height="76" rx="2"/>
       <path d="M314 150 l22 -34 16 20 14 -22 20 36 z" fill="#e6eede" stroke-width="2"/>
       <circle cx="330" cy="108" r="7" fill="#fdf3c8" stroke-width="2"/>
     </g>`,
    // faint wallpaper stripes
    `<g stroke="#e6dcc4" stroke-width="6">
       ${Array.from({ length: 18 }, (_, i) => {
         const x = VIEW.x + 30 + i * 64;
         return `<line x1="${x}" y1="${VIEW.y}" x2="${x}" y2="250"/>`;
       }).join('')}
     </g>`,
  ],

  // Rolling pastoral hills receding to a high horizon.
  pastoral: [
    wash('#eef4fb'),
    // far hills
    `<path d="M${VIEW.x} 210 q220 -70 460 -6 q240 62 660 -10 v${VIEW.y + VIEW.h - 210} h-${VIEW.w} z" fill="#dde9cd" stroke="${ink}" stroke-width="1.5"/>`,
    // near hills
    `<path d="M${VIEW.x} 262 q260 -60 540 4 q220 50 580 -8 v${VIEW.y + VIEW.h - 262} h-${VIEW.w} z" fill="#d0e0bd" stroke="${ink}" stroke-width="1.5"/>`,
    // sun
    `<circle cx="470" cy="-230" r="40" fill="#fdf3c8" stroke="${ink}" stroke-width="1.5"/>`,
    // a winding path
    `<path d="M180 300 q40 -30 10 -60 q-30 -30 20 -56" fill="none" stroke="#c7b48f" stroke-width="10" stroke-linecap="round"/>`,
  ],
};

for (const [id, parts] of Object.entries(scenes)) {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${VIEW.x} ${VIEW.y} ${VIEW.w} ${VIEW.h}" width="${VIEW.w}" height="${VIEW.h}">\n` +
    `  <!-- ground line at world y=${GROUND}; characters stand here -->\n  ` +
    parts.join('\n  ') +
    `\n</svg>\n`;
  writeFileSync(join(here, `${id}.svg`), svg, 'utf8');
  console.log(`wrote ${id}.svg`);
}
