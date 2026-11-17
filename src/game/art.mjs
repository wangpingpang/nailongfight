// Presentation only. All positions, timelines and hit shapes come from the battle snapshot.
const pictures = new Map();
const effects = new WeakMap();
const GOLD = '#ffce80';
const MINT = '#a1f0dc';

function picture(path) {
  if (!path) return null;
  if (!pictures.has(path)) {
    const image = new Image();
    image.src = path;
    pictures.set(path, image);
  }
  return pictures.get(path);
}

function available(image) {
  return image && image.complete && image.naturalWidth > 0;
}

function ring(ctx, x, y, rx, ry) {
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, 2 * Math.PI);
}

function pathLine(ctx, points) {
  ctx.beginPath();
  for (let i = 0; i < points.length; i += 2) {
    if (i === 0) ctx.moveTo(points[i], points[i + 1]);
    else ctx.lineTo(points[i], points[i + 1]);
  }
  ctx.stroke();
}

function projection(width, height, rules) {
  const left = width * .045, top = height * .575;
  const ux = width * .91 / rules.arenaWidth;
  const uy = height * .345 / rules.arenaDepth;
  return {width, height, ux, uy, x: x => left + x * ux, y: y => top + y * uy};
}

function label(ctx, text, x, y, size, color) {
  ctx.font = 'bold ' + size + 'px system-ui, sans-serif';
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x, y);
}

function teamInk(team) { return team === 1 ? MINT : GOLD; }

function drawBackdrop(ctx, view, cfg) {
  const {width, height} = view;
  const bg = picture(cfg.assets.field?.path || './assets/arena-field.svg');
  ctx.fillStyle = '#547476';
  ctx.fillRect(0, 0, width, height);
  if (available(bg)) ctx.drawImage(bg, 0, 0, width, height);
  else {
    ctx.fillStyle = '#435e60';
    ctx.fillRect(0, height * .53, width, height * .47);
    if (bg.complete) label(ctx, '场景素材缺失', width / 2, height * .2, 15, '#f2dfbb');
  }
  // Corner marks identify the extent of the walkable floor without hiding attack cues.
  ctx.strokeStyle = '#cbd8c2';
  ctx.lineWidth = Math.max(1, width / 750);
  const x0 = view.x(0), y0 = view.y(0);
  const x1 = view.x(cfg.rules.arenaWidth), y1 = view.y(cfg.rules.arenaDepth);
  for (const [x,y,dx,dy] of [[x0,y0,1,1],[x1,y0,-1,1],[x0,y1,1,-1],[x1,y1,-1,-1]]) {
    pathLine(ctx, [x, y + dy * 7, x, y, x + dx * 20, y]);
  }
}

function drawTelegraph(ctx, view, shape) {
  const x = view.x(shape.x), y = view.y(shape.y);
  const circle = shape.kind === 'circle';
  const rx = (circle ? shape.radius : shape.width / 2) * view.ux;
  const ry = (circle ? shape.radius : shape.depth / 2) * view.uy;
  const active = shape.phase === 'active', guard = shape.phase === 'guard';
  const ink = guard ? '#e3e6f9' : teamInk(shape.team);
  ctx.save();
  if (circle) ring(ctx, x, y, rx, ry);
  else {
    ctx.beginPath();
    ctx.rect(x - rx, y - ry, rx * 2, ry * 2);
  }
  ctx.fillStyle = ink;
  ctx.globalAlpha = active ? .40 : .17;
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.strokeStyle = '#394751';
  ctx.lineWidth = active ? 4 : 3;
  ctx.stroke();
  ctx.strokeStyle = ink;
  ctx.lineWidth = active ? 2.6 : 1.8;
  ctx.setLineDash(active || guard ? [] : [6, 3]);
  ctx.stroke();
  // Same outline as the simulated shape; texture distinguishes warning / guard / active.
  if (guard || active) {
    ctx.clip();
    ctx.setLineDash([]);
    ctx.globalAlpha = active ? .32 : .55;
    ctx.lineWidth = 2;
    for (let n = -rx - ry; n < rx + ry; n += guard ? 15 : 9) {
      pathLine(ctx, [x + n - ry, y + ry, x + n + ry, y - ry]);
    }
  }
  ctx.restore();
}

function drawSpawn(ctx, view, spot, frame, reduced) {
  const x = view.x(spot.x), y = view.y(spot.y);
  const r = view.ux * (.45 + (reduced ? 0 : .06 * Math.sin(frame * .13)));
  ctx.save();
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#ffdda4';
  ctx.fillStyle = '#a6502f80';
  ring(ctx, x, y, r, r * .29);
  ctx.fill(); ctx.stroke();
  ctx.setLineDash([2, 4]);
  pathLine(ctx, [x, y, x, y - r * 1.25]);
  ctx.setLineDash([]);
  ctx.fillStyle = '#34414a';
  ctx.beginPath();
  ctx.moveTo(x, y - r * 1.3 - 10);
  ctx.lineTo(x + 9, y - r * 1.3 + 6);
  ctx.lineTo(x - 9, y - r * 1.3 + 6);
  ctx.closePath(); ctx.fill(); ctx.stroke();
  label(ctx, '!', x, y - r * 1.3, 10, GOLD);
  ctx.restore();
}

function pose(actor, reduced) {
  const p = {angle:0, sx:1, sy:1, lift:0, forward:0};
  const age = actor.age;
  const motion = reduced ? 0 : 1;
  if (actor.state === 'DOWN' || actor.state === 'DEAD') {
    p.angle = -.62; p.sy = .57; p.lift = .045;
  } else if (actor.state === 'HIT') {
    p.angle = -.17 * Math.max(0, 1 - age / Math.max(1, actor.duration));
    p.sy = .94;
  } else if (actor.state === 'MOVE' || actor.state === 'GETUP') {
    const step = Math.sin(age * .40);
    p.angle = (.07 + .028 * step) * motion;
    p.lift = Math.abs(step) * .035 * motion;
  } else if (actor.state === 'EVADE' || actor.state === 'ESCAPE') {
    p.angle = -.20; p.sx = 1.12; p.sy = .76;
  } else if (actor.cast) {
    const {skill, counter, charge} = actor.cast;
    const startup = counter ? skill.effect.counterStartup : skill.startup;
    const active = counter ? skill.effect.counterActive : skill.active;
    const duration = actor.duration;
    if (age <= startup) {
      const t = age / Math.max(startup, 1);
      p.angle = -.16 * t;
      p.sx = 1 + .08 * t; p.sy = 1 - .17 * t;
    } else if (skill.effect.type === 'charge' && !actor.cast.spawned) {
      const t = charge / skill.effect.chargeFrames;
      p.sx = 1 + .19 * t; p.sy = 1 + .19 * t; p.lift = .025 * t;
    } else {
      const strength = age <= startup + active ? 1 : Math.max(0, (duration - age) / Math.max(1, skill.recovery));
      p.forward = .09 * strength;
      p.angle = .17 * strength;
      p.sx = 1 + .12 * strength; p.sy = 1 - .06 * strength;
      if (skill.effect.type === 'parry' && !counter) { p.angle = -.12; p.sy = .82; }
    }
    if (skill.effect.type === 'leap' && age < startup) {
      p.lift += Math.sin(Math.PI * age / Math.max(1, startup)) * .27 * motion;
    }
  } else p.lift = .01 * (1 + Math.sin((age + actor.team * 15) * .10)) * motion;
  return p;
}

function drawActor(ctx, view, battle, actor, reduced) {
  if (actor.state === 'DEAD' && actor.age > 35) return;
  const profile = battle.config.characters[actor.characterId];
  const image = picture(battle.config.assets[profile.asset]?.path);
  const x = view.x(actor.x), footY = view.y(actor.y);
  const depth = actor.y / battle.config.rules.arenaDepth;
  const size = Math.min(view.ux * 2.26, view.height * .41) * (.93 + .10 * depth);
  const color = teamInk(actor.team);
  const p = pose(actor, reduced);
  const dead = actor.state === 'DEAD';
  const guarded = ['GETUP','EVADE','ESCAPE'].includes(actor.state);
  ctx.save();
  ctx.fillStyle = dead ? '#283e4880' : '#22383d9c';
  ring(ctx, x, footY, size * .34, size * .061);
  ctx.fill();
  if (!dead) {
    ctx.setLineDash(actor.team === 1 ? [] : [5,3]);
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.setLineDash([]);
  }
  const footOffset = size * .70;
  ctx.save();
  ctx.translate(x + actor.facing * p.forward * size, footY - p.lift * size);
  ctx.scale(actor.facing, 1);
  ctx.rotate(p.angle);
  ctx.scale(p.sx,p.sy);
  if (guarded) ctx.globalAlpha = .77;
  if (dead) ctx.globalAlpha = .55 * Math.max(0, 1 - actor.age / 36);
  if (available(image)) {
    // Images share a 240×200 artboard. The ground anchor is defined visually beneath the feet.
    ctx.drawImage(image, -size / 2, -footOffset, size, size * 5 / 6);
  } else {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(-size * .27,-size * .18); ctx.lineTo(0,-size * .5);
    ctx.lineTo(size * .27,-size * .18); ctx.lineTo(0,-size * .03); ctx.closePath(); ctx.fill();
  }
  ctx.restore();
  if (!dead) {
    const hpWidth = Math.min(55, size * .44), barH = Math.max(3, size / 32);
    const tagY = footY - size * (.69 + p.lift);
    const idLabel = actor.team === 1 ? 'P1' : battle.mode === 'pvp' ? 'P2'
      : battle.mode === 'training' ? '训练假人' : 'CPU';
    const textSize = Math.max(10, Math.min(15, size * .088));
    ctx.font = 'bold ' + textSize + 'px system-ui, sans-serif';
    const plateW = Math.max(ctx.measureText(idLabel).width + 10, hpWidth * .57);
    ctx.fillStyle = '#233841';
    ctx.fillRect(x - plateW / 2, tagY - textSize * 1.4, plateW, textSize * 1.3);
    label(ctx, idLabel, x, tagY - textSize * .72, textSize, color);
    ctx.fillStyle = '#283c43';
    ctx.fillRect(x-hpWidth/2-1, tagY, hpWidth+2, barH+2);
    ctx.fillStyle = color;
    ctx.fillRect(x-hpWidth/2, tagY+1, hpWidth * Math.max(0,actor.hp/actor.maxHp), barH);
    if (!image || (image.complete && !available(image))) {
      label(ctx, '角色素材缺失', x, tagY - textSize * 2, textSize, '#fff0c9');
    }
  }
  if (guarded) {
    const r = size * .28;
    ctx.strokeStyle = '#d4fbe6'; ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, footY - size * .23, r, -1.25, .45); ctx.stroke();
  }
  ctx.restore();
}

function drawEntity(ctx, view, e, frame, reduced) {
  const groundY = view.y(e.y), x = view.x(e.x);
  const projectile = e.kind === 'projectile';
  const r = Math.max(3, e.radius * view.ux * (projectile ? .88 : .23));
  const y = groundY - (projectile ? Math.min(view.ux * .36, view.height * .10) : r * .35);
  ctx.save();
  ctx.fillStyle = '#2b45486b';
  ring(ctx, x, groundY, r, r * .22); ctx.fill();
  if (projectile && !reduced) {
    ctx.lineWidth = Math.max(1, r * .15);
    ctx.strokeStyle = '#dbdfc3';
    const facing = e.cast?.facing ?? 1;
    pathLine(ctx, [x - facing * r, y, x - facing * r * 2.4, y + r * .12]);
  }
  ctx.strokeStyle = '#3d4658'; ctx.lineWidth = Math.max(1.5, r * .13);
  ring(ctx, x, y, r, projectile ? r * .77 : r * .67);
  ctx.fillStyle = '#a5a7cb'; ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#d4d7e3';
  const bob = reduced ? 0 : Math.sin(frame * .17) * r * .08;
  ring(ctx, x - r * .23, y - r * .27 + bob, r * .37, r * .14); ctx.fill();
  ctx.restore();
}

/** Keep transient hit feedback even when several logical frames run between visible frames. */
export function recordBattleFeedback(battle) {
  let fx = effects.get(battle);
  if (!fx) { fx = {frame:-1, hits:[]}; effects.set(battle, fx); }
  if (battle.frame === fx.frame) return;
  fx.frame = battle.frame;
  fx.hits = fx.hits.filter(hit => battle.frame - hit.at <= 25);
  for (const event of battle.events) {
    if (event.type === 'hit') fx.hits.push({...event, at:battle.frame});
  }
}

function drawHits(ctx, view, battle, reduced) {
  const fx = effects.get(battle);
  for (const hit of fx.hits) {
    const age = battle.frame - hit.at, t = age / 26;
    const x = view.x(hit.x), y = view.y(hit.y) - view.ux * .76;
    ctx.save();
    ctx.globalAlpha = Math.min(1, (1 - t) * 2);
    if (!reduced && age < 10) {
      const radius = Math.min(32,view.ux * .42) * (.55 + age * .08);
      ctx.strokeStyle = '#ffdf9b';
      ctx.lineWidth = 3;
      for (let i=0; i<7; i++) {
        const a = i * Math.PI * 2 / 7 + .24;
        const dx = Math.cos(a) * radius, dy = Math.sin(a) * radius;
        pathLine(ctx,[x + dx * .48, y + dy * .48, x + dx, y + dy]);
      }
    }
    const ty = y - (reduced ? 14 : 14 + 17 * t);
    const size = Math.max(14,Math.min(22, view.ux * .25));
    const text = '−' + hit.damage;
    ctx.lineWidth = 3; ctx.strokeStyle = '#32404b';
    ctx.font = 'bold '+size+'px system-ui, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.strokeText(text,x,ty);
    label(ctx,text,x,ty,size,'#fff0ba');
    ctx.restore();
  }
}

/**
 * Paint one read-only battle snapshot. Draw order follows ground depth while projected
 * attack shapes retain their exact simulation coordinates. A paused frame stays still.
 */
export function drawArena(canvas, battle, settings = {}) {
  if (!canvas || !battle) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const width = canvas.clientWidth || canvas.width;
  const height = canvas.clientHeight || canvas.height;
  const dpr = Math.min(globalThis.devicePixelRatio || 1, 2);
  const backingW = Math.round(width * dpr), backingH = Math.round(height * dpr);
  if (canvas.width !== backingW || canvas.height !== backingH) {
    canvas.width = backingW; canvas.height = backingH;
  }
  ctx.save();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const view = projection(width,height,battle.config.rules);
  const reduced = Boolean(settings.reduceEffects);
  drawBackdrop(ctx, view, battle.config);
  for (const shape of battle.telegraphs) drawTelegraph(ctx,view,shape);
  for (const spot of battle.stage?.warnings ?? []) drawSpawn(ctx,view,spot,battle.frame,reduced);
  const layers = [
    ...battle.actors.map(actor => ({y:actor.y, actor})),
    ...battle.entities.map(entity => ({y:entity.y, entity}))
  ].sort((a,b) => a.y - b.y);
  for (const layer of layers) {
    if (layer.actor) drawActor(ctx,view,battle,layer.actor,reduced);
    else drawEntity(ctx,view,layer.entity,battle.frame,reduced);
  }
  recordBattleFeedback(battle);
  drawHits(ctx, view, battle, reduced);
  ctx.restore();
}
