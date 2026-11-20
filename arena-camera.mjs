import {CAMERA_HARD_INSET, FLOOR_WIDTH_FRACTION} from './config.mjs';

const frames = new WeakMap();
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

export const tagTextSize = size => clamp(size * .088, 10, 15);
const headroom = size => size * .94 + tagTextSize(size) * 1.4;

export function fighterSize(view, rules, depthY) {
  return Math.min(view.ux * 2.26, view.height * .41) * (.93 + .10 * depthY / rules.arenaDepth);
}

export function projection(width, height, config) {
  const {rules, camera} = config;
  const left = width * (1 - FLOOR_WIDTH_FRACTION) / 2;
  const ux = width * FLOOR_WIDTH_FRACTION / rules.arenaWidth;
  const view = {width, height, ux};
  let floorDepth = height * .345;
  if (camera) {
    // On short canvases the nameplate has a minimum readable size. Compress
    // only the drawn floor depth enough to fit front and rear fighters together.
    const back = fighterSize(view, rules, 0);
    const front = fighterSize(view, rules, rules.arenaDepth);
    const room = height * camera.viewFraction - headroom(back) - front * .07;
    floorDepth = Math.min(floorDepth, Math.max(0, room));
  }
  const top = height * (.575 + .345 / 2) - floorDepth / 2;
  const uy = floorDepth / rules.arenaDepth;
  return {...view, uy, x: x => left + x * ux, y: y => top + y * uy};
}

// All camera distances below are fractions of the complete stage artwork.
// Keep the old origin inside the feasible interval so movement in the middle
// of the picture, including fighters swapping sides, leaves the camera still.
function fitAxis(origin, near, far, size, margin) {
  const low = far - size + margin;
  const high = near - margin;
  return clamp(low <= high ? clamp(origin, low, high) : (low + high) / 2, 0, 1 - size);
}

export function arenaFrame(view, battle) {
  const config = battle.config;
  if (!config.camera) return {left:0, top:0, size:1};
  const {viewFraction:size, edgeInset} = config.camera;
  const previous = frames.get(battle);
  const fresh = !previous || battle.frame < previous.frame;
  const dt = fresh ? 0 : Math.max(0, battle.frame - previous.frame);
  const blend = fresh ? 1 : -Math.expm1(-dt / (.085 * config.rules.tickRate));
  const hero = battle.actors.find(a => a.team === 1);
  const subjects = battle.mode === 'pve'
    ? [hero, ...battle.actors.filter(a => a !== hero && a.hp > 0), ...(battle.stage?.warnings ?? [])].filter(Boolean)
    : battle.actors;

  let left = Infinity, right = -Infinity, top = Infinity, bottom = -Infinity;
  for (const subject of subjects) {
    const x = view.x(subject.x) / view.width;
    const y = view.y(subject.y) / view.height;
    const height = fighterSize(view, config.rules, subject.y);
    // Frame the nameplate as well as the feet. For an incoming wave this
    // reserves space for the arriving opponent while the warning is on screen.
    left = Math.min(left, x);
    right = Math.max(right, x);
    top = Math.min(top, y - headroom(height) / view.height);
    bottom = Math.max(bottom, y + height * .07 / view.height);
  }
  if (!subjects.length) return previous ?? {left:(1-size)/2, top:1-size, size};

  const startX = fresh ? (left + right - size) / 2 : previous.left;
  const startY = fresh ? (top + bottom - size) / 2 : previous.top;
  const goalX = fitAxis(startX, left, right, size, size * edgeInset);
  const goalY = fitAxis(startY, top, bottom, size, size * edgeInset);
  // Ease into the soft margin, but catch fast dashes before a fighter leaves
  // the image. A repaint of the same tick has zero elapsed camera time.
  let originX = fitAxis(startX + (goalX-startX)*blend, left, right, size, size * CAMERA_HARD_INSET);
  const originY = fitAxis(startY + (goalY-startY)*blend, top, bottom, size, 0);
  if (battle.mode === 'pve' && hero) {
    // Waves may span the entire arena. When they cannot fit together,
    // retain the player's safe margin while showing as much of the wave as fits.
    const x = view.x(hero.x) / view.width;
    originX = fitAxis(originX, x, x, size, size * CAMERA_HARD_INSET);
  }
  const next = {left:originX, top:originY, size, frame:battle.frame};
  frames.set(battle, next);
  return next;
}
