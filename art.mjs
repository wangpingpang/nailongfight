// Presentation only. All positions, timelines and hit shapes come from the battle snapshot.
const pictures = new Map();
const effects = new WeakMap();
const reducedMotion = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)');
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

function fighterSize(view, rules, depthY) {
  return Math.min(view.ux * 2.26, view.height * .41) * (.93 + .10 * depthY / rules.arenaDepth);
}

function drawBackdrop(ctx, view, battle) {
  const {width, height} = view;
  const cfg = battle.config;
  const scene = cfg.scenes[battle.sceneId ?? cfg.defaultScene];
  const bg = picture(cfg.assets[scene.asset].path);
  ctx.fillStyle = '#547476';
  ctx.fillRect(0, 0, width, height);
  if (available(bg)) {
    const scale = Math.max(width / bg.naturalWidth, height / bg.naturalHeight);
    const cropW = width / scale, cropH = height / scale;
    ctx.drawImage(bg, (bg.naturalWidth - cropW) / 2, (bg.naturalHeight - cropH) * .55,
      cropW, cropH, 0, 0, width, height);
  }
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
  const round = shape.kind === 'circle' || shape.kind === 'semicircle';
  const rx = (round ? shape.radius : shape.width / 2) * view.ux;
  const ry = (round ? shape.radius : shape.depth / 2) * view.uy;
  const active = shape.phase === 'active', guard = shape.phase === 'guard';
  const ink = guard ? '#e3e6f9' : teamInk(shape.team);
  ctx.save();
  if (shape.kind === 'semicircle') {
    const start = shape.facing === -1 ? Math.PI / 2 : -Math.PI / 2;
    ctx.beginPath();
    ctx.ellipse(x,y,rx,ry,0,start,start + Math.PI);
    ctx.closePath();
  } else if (round) ring(ctx, x, y, rx, ry);
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

const actionForState = {
  IDLE:'idle', MOVE:'run', BASIC:'basic', EVADE:'evade', ESCAPE:'escape',
  ULT:'ult', HIT:'hit', DOWN:'down', GETUP:'getup', DEAD:'defeat'
};

const r1StateActions = {
  IDLE:'idle', MOVE:'move', EVADE:'evade', ESCAPE:'escape', ULT:'ult',
  HIT:'hit', DOWN:'down', GETUP:'getup', DEAD:'death'
};

/** Resolve a real simulation age to the module's sprite sheet, row and column. */
export function selectActionFrame(animation, actor) {
  if (animation.cell) {
    let id = r1StateActions[actor.state] ?? 'idle'
    if (actor.state === 'BASIC') id = 'basic' + ((actor.cast?.basicIndex ?? 0) + 1)
    if (actor.state === 'SKILL') id = actor.cast?.button === 's2' ? 'skill2' : 'skill1'
    const action = animation.actions.find(item => item.id === id)
    const total = action.durations.reduce((sum, duration) => sum + duration, 0)
    const age = Math.max(0, actor.age - 1)
    let tick = age
    if (action.loop) tick %= total
    if (!actor.cast && !action.loop && Number.isFinite(actor.duration) && actor.duration > 0) {
      tick = age * total / actor.duration
    }
    // Release-on-input shortens only the slide. The strike still occupies its
    // full active window and the original recovery still follows.
    const stopped = actor.cast?.slideStoppedAt
    if (stopped != null && age >= stopped) {
      tick = action.durations[0] + action.durations[1] + age - stopped
    }
    let index = 0
    while (index < action.durations.length - 1 && tick >= action.durations[index]) {
      tick -= action.durations[index++]
    }
    return {sheet:action.sheet, row:action.row, column:action.columns[index]}
  }
  const id = actor.state === 'SKILL' ? actor.cast?.button : actionForState[actor.state];
  const action = animation.actions.find(a => a.id === id) || animation.actions[0];
  const isBasic = id === 'basic';
  const first = isBasic ? (actor.cast?.basicIndex ?? 0) * 2 : 0;
  const end = isBasic ? first + 2 : action.columns.length;
  const age = Math.max(0,actor.age - 1);
  let index = first;
  const stop = actor.cast?.slideStoppedAt;
  if (stop != null && actor.cast.earlyStop && age >= stop) {
    // The final two courier poses are the strike and recovery after an early stop.
    index = age < stop + actor.cast.skill.active ? 4 : 5;
  } else {
    const length = action.durations.slice(first,end).reduce((n,d) => n+d,0);
    const duration = actor.cast?.earlyStop ? length : actor.duration;
    let tick = age;
    if (action.loop) tick %= length;
    else if (Number.isFinite(duration) && duration > 0) tick = age * length / duration;
    while (index < end - 1 && tick >= action.durations[index]) {
      tick -= action.durations[index];
      index++;
    }
  }
  return {sheet:action.sheet, row:action.row, column:action.columns[index]};
}

function spriteFrame(config, animation, actor) {
  // Queue the other action sheets before the player first uses those buttons.
  for (const asset of Object.values(animation.sheets)) picture(config.assets[asset]?.path);
  const selected = selectActionFrame(animation, actor);
  const image = picture(config.assets[animation.sheets[selected.sheet]]?.path);
  const standing = picture(config.assets[animation.sheets.A]?.path);
  const fallback = !available(image) && available(standing);
  return {
    image:fallback ? standing : image,
    column:fallback ? 0 : selected.column, row:fallback ? 0 : selected.row,
    missing:!image || (image.complete && !available(image))
  };
}

function drawActor(ctx, view, battle, actor, reduced, contact) {
  const profile = battle.config.characters[actor.characterId];
  const animation = battle.config.animations?.[profile.animation];
  const defeatFrames = actor.state === 'DEAD' && animation
    ? animation.actions.find(a=>a.id===(animation.cell ? 'death' : 'defeat')).durations.reduce((a,b)=>a+b,0) : 35;
  if (actor.state === 'DEAD' && actor.age > defeatFrames + 12) return;
  const frame = animation && spriteFrame(battle.config, animation, actor);
  const image = frame ? frame.image : picture(battle.config.assets[profile.asset]?.path);
  // The ground marker, sprite and nameplate must move together while an
  // instantaneous simulation knockback settles into its visible ground position.
  const settle = contact && !reduced ? Math.max(0,1 - contact.age/6) ** 2 : 0;
  const x = view.x(actor.x - (contact?.hit.pushX ?? 0)*settle);
  const footY = view.y(actor.y - (contact?.hit.pushY ?? 0)*settle);
  const size = fighterSize(view,battle.config.rules,actor.y);
  const color = teamInk(actor.team);
  const p = frame ? {angle:0,sx:1,sy:1,lift:0,forward:0} : pose(actor, reduced);
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
  const sample = profile.presentation === 'sample';
  const footOffset = size * .70;
  ctx.save();
  let offsetX = 0, lean = 0;
  if (contact && !reduced) {
    const {hit, age, strength} = contact;
    offsetX = hit.dir * size * hit.style.recoil * strength * .30;
    lean = hit.dir * hit.style.recoil * strength;
    if (age < hit.style.flash) ctx.filter = 'brightness(1.38) saturate(.76)';
  }
  ctx.translate(x + offsetX + actor.facing * p.forward * size, footY - p.lift * size);
  ctx.rotate(lean);
  ctx.scale(actor.facing, 1);
  ctx.rotate(p.angle);
  if (!sample) ctx.scale(p.sx,p.sy);
  if (guarded) ctx.globalAlpha = .77;
  if (dead) ctx.globalAlpha = Math.min(1,Math.max(0,(defeatFrames + 12 - actor.age) / 12));
  if (frame && available(image)) {
    const cellWidth = image.naturalWidth / animation.columns;
    const cellHeight = image.naturalHeight / animation.rows;
    const displaySize = size * .90;
    const pivot = animation.pivot ?? [cellWidth / 2, cellHeight * 246 / 256];
    ctx.drawImage(image,frame.column*cellWidth,frame.row*cellHeight,cellWidth,cellHeight,
      -displaySize * pivot[0] / cellWidth, -displaySize * pivot[1] / cellHeight, displaySize, displaySize);
  } else if (sample && available(image)) {
    // Preserve the source crop and proportions; its lower edge anchors the pose.
    const scale = size * .86 / Math.max(image.naturalWidth, image.naturalHeight);
    const width = image.naturalWidth * scale;
    const height = image.naturalHeight * scale;
    ctx.drawImage(image, -width / 2, -height, width, height);
  } else if (available(image)) {
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
    const tagY = footY - size * ((frame || sample ? .91 : .69) + p.lift);
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
    if (frame?.missing || !image || (image.complete && !available(image))) {
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

function drawGroundEffect(ctx, view, entity, frame) {
  const x = view.x(entity.x), y = view.y(entity.y);
  const remaining = Math.max(0,1 - (frame - entity.born) / entity.lifetime);
  const ink = teamInk(entity.team);
  ctx.save();
  if (entity.kind === 'field') {
    const rx = entity.radius * view.ux, ry = entity.radius * view.uy;
    ring(ctx,x,y,rx,ry);
    ctx.fillStyle = '#f1db8440'; ctx.fill();
    ctx.strokeStyle = '#514533'; ctx.lineWidth = 4; ctx.stroke();
    ctx.strokeStyle = ink; ctx.lineWidth = 1.8; ctx.stroke();
    ring(ctx,x,y,rx*.94,ry*.92);
    ctx.strokeStyle = '#fff0b1'; ctx.setLineDash([3,6]); ctx.stroke();
  } else {
    const r = Math.max(6, view.ux * .18);
    ctx.beginPath();
    ctx.moveTo(x-r,y); ctx.lineTo(x,y-r*.42); ctx.lineTo(x+r,y); ctx.lineTo(x,y+r*.42); ctx.closePath();
    ctx.fillStyle = '#385761'; ctx.fill();
    ctx.strokeStyle = ink; ctx.lineWidth = 2; ctx.stroke();
    pathLine(ctx,[x,y,x,y-r*2]);
    ctx.beginPath();
    ctx.moveTo(x,y-r*2); ctx.lineTo(x+r*1.1,y-r*1.63); ctx.lineTo(x,y-r*1.28);
    ctx.fillStyle = ink; ctx.fill();
    ctx.strokeStyle = '#344954'; ctx.lineWidth = 3;
    pathLine(ctx,[x-r,y+r*.82,x+r,y+r*.82]);
    ctx.strokeStyle = ink; ctx.lineWidth = 2;
    pathLine(ctx,[x-r,y+r*.82,x-r+r*2*remaining,y+r*.82]);
  }
  ctx.restore();
}

// Visual units only. Recoil is a lean in radians, camera is a CSS-pixel upper bound.
const impactStyles = {
  light:    {life:21, burst:6,  radius:.34, rays:4,  recoil:.070, react:6,  flash:1, camera:0,   color:'#ffe5ae'},
  medium:   {life:25, burst:9,  radius:.54, rays:6,  recoil:.115, react:8,  flash:1, camera:1.5, color:'#ffc778'},
  heavy:    {life:29, burst:11, radius:.75, rays:8,  recoil:.185, react:11, flash:2, camera:3.7, color:'#ff9b68'},
  ultimate: {life:34, burst:14, radius:.98, rays:10, recoil:.235, react:14, flash:2, camera:5.3, color:'#ffc566'},
  guard:    {life:24, burst:9,  radius:.50, rays:0,  recoil:.045, react:7,  flash:0, camera:.9,  color:'#b4f4eb'}
};

/**
 * Collect hit/parry events once per completed simulation frame. A held tick advances
 * only presentation time; repeated paints and pause screens advance neither clock.
 */
export function recordBattleFeedback(battle, heldTick = false) {
  let fx = effects.get(battle);
  if (!fx || battle.frame < fx.frame) {
    fx = {frame:battle.frame - 1, clock:0, hits:[]};
    effects.set(battle,fx);
  }
  if (!heldTick && fx.frame === battle.frame) return fx;
  fx.clock += heldTick ? 1 : Math.max(1,battle.frame-fx.frame);
  fx.hits = fx.hits.filter(hit => fx.clock-hit.at < hit.style.life);
  if (heldTick) return fx;
  fx.frame = battle.frame;
  for (const event of battle.events) {
    if (event.type !== 'hit' && event.type !== 'parry') continue;
    const target = battle.actors.find(a => a.id === event.targetId);
    if (!target) continue;
    const style = impactStyles[event.type === 'parry' ? 'guard' : event.impact] ?? impactStyles.light;
    const dir = event.dir || Math.sign(target.x - (event.x ?? target.x)) || -target.facing;
    fx.hits.push({
      ...event, at:fx.clock, style, dir, mark:event.type === 'parry' ? '招架' : '−' + event.damage,
      x:event.x ?? target.x, y:event.y ?? target.y,
      pushX:target.x - (event.targetX ?? target.x), pushY:target.y - (event.targetY ?? target.y),
      tall:Boolean(battle.config.characters[target.characterId].animation)
    });
  }
  return fx;
}

function actorContact(fx, id) {
  let best = null;
  for (const hit of fx.hits) {
    const age = fx.clock - hit.at;
    if (hit.targetId !== id || age >= hit.style.react) continue;
    const strength = (1 - age / hit.style.react) ** 1.4;
    if (!best || hit.style.recoil * strength >= best.hit.style.recoil * best.strength)
      best = {hit, age, strength};
  }
  return best;
}

function cameraImpulse(ctx, view, fx) {
  let strongest = 0, direction = 1, tick = 0;
  for (const hit of fx.hits) {
    const age = fx.clock - hit.at;
    const energy = hit.style.camera * Math.max(0, 1 - age / hit.style.burst) ** 2;
    if (energy <= strongest) continue;
    strongest = energy;
    direction = hit.dir;
    tick = age;
  }
  if (!strongest) return;
  const amplitude = strongest * Math.min(1,view.width / 900);
  const dx = amplitude * direction * Math.cos(tick * 1.26);
  const dy = -amplitude * .39 * Math.cos(tick * 1.68);
  // Overscan by exactly the maximum displacement. The shaken battlefield still
  // covers every viewport edge, including on the narrowest supported canvas.
  const zoom = 1 + 2 * Math.max(amplitude / view.width, amplitude * .39 / view.height);
  ctx.translate(dx + view.width * (1-zoom)/2, dy + view.height * (1-zoom)/2);
  ctx.scale(zoom,zoom);
}

function contactBurst(ctx, hit, radius, age) {
  const {style} = hit;
  const t = age/style.burst;
  const spread = radius * (.58 + .90*t);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.globalAlpha = Math.max(0,1-t*t);
  if (hit.type === 'parry') {
    // An open shield arc faces the incoming strike; no damage star or blood-like detail.
    const r = spread * .84;
    ctx.strokeStyle = '#344854'; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.ellipse(0,0,r*.50,r,0,Math.PI*.61,Math.PI*1.39); ctx.stroke();
    ctx.strokeStyle = style.color; ctx.lineWidth = 2.7; ctx.stroke();
    ctx.strokeStyle = '#f7ffdf'; ctx.lineWidth = 1.5;
    pathLine(ctx,[-r*.75, -r*.30, -r*.98, -r*.49]);
    pathLine(ctx,[-r*.82, r*.08, -r*1.12,r*.12]);
    return;
  }
  const core = radius * Math.max(0,.43 - t*.82);
  if (core > 0) {
    ctx.fillStyle = '#fff5cc'; ctx.strokeStyle = '#735342'; ctx.lineWidth = 1.25;
    ctx.beginPath();
    for (let i=0; i<12; i++) {
      const a = i*Math.PI/6, r = i%2 ? core*.32 : core;
      const px = Math.cos(a)*r, py = Math.sin(a)*r;
      if (i===0) ctx.moveTo(px,py); else ctx.lineTo(px,py);
    }
    ctx.closePath(); ctx.fill(); ctx.stroke();
  }
  for (let i=0; i<style.rays; i++) {
    // Most shards travel with the incoming blow. A few back-sparks locate its origin.
    const a = i === style.rays-1 ? 2.85 : -1.20 + 2.39 * i / Math.max(1,style.rays-2);
    const dx = Math.cos(a), dy = Math.sin(a);
    const range = spread * (.75 + (i*7%5)*.09);
    const near = range * (.25 + t*.55);
    const wide = Math.max(.5, radius * .052 * (1-t));
    ctx.fillStyle = i%3 ? style.color : '#fff4d3';
    ctx.strokeStyle = '#624c42'; ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(dx*near-dy*wide,dy*near+dx*wide);
    ctx.lineTo(dx*range,dy*range);
    ctx.lineTo(dx*near+dy*wide,dy*near-dx*wide);
    ctx.closePath(); ctx.fill(); ctx.stroke();
  }
  if (style.rays >= 8 && age > 0) {
    ctx.strokeStyle = style.color; ctx.lineWidth = Math.max(1,2.5*(1-t));
    ctx.beginPath();
    ctx.ellipse(0,0,spread*.47,spread*.67,0,-1.15,1.03);
    ctx.stroke();
  }
}

function drawHits(ctx, view, battle, fx, reduced) {
  const labels = new Map();
  // New damage stays closest to the contact. Older numbers move above it instead
  // of crossing the new label halfway through a fast three-hit sequence.
  for (let i=fx.hits.length-1; i>=0; i--) {
    const hit = fx.hits[i];
    const age = fx.clock - hit.at;
    const life = reduced ? Math.min(17,hit.style.life) : hit.style.life;
    if (age >= life) continue;
    const t = age / life;
    const size = fighterSize(view,battle.config.rules,hit.y);
    const x = view.x(hit.x);
    const y = view.y(hit.y) - size*(hit.tall ? .44 : .29);
    const radius = Math.min(57, view.ux*hit.style.radius);
    if (!reduced && age < hit.style.burst) {
      ctx.save();
      ctx.translate(x,y);
      ctx.scale(hit.dir,1);
      contactBurst(ctx,hit,radius,age);
      ctx.restore();
    }
    const previous = labels.get(hit.targetId);
    if (previous?.count >= 3) continue;
    const textSize = Math.min(25,Math.max(12,view.ux * (.20 + hit.style.radius*.11)));
    const textX = x + (reduced ? 0 : hit.dir*radius*(.20+t*.30));
    const textY = Math.min(y - radius*.47 - (reduced ? 6 : 9 + 20*t),
      previous ? previous.top - textSize*.55 - 2 : Infinity);
    labels.set(hit.targetId,{top:textY-textSize*.55,count:(previous?.count ?? 0)+1});
    ctx.save();
    ctx.globalAlpha = Math.min(1,(1-t)*3);
    ctx.font = 'bold ' + textSize + 'px system-ui, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.strokeStyle = '#2b3540'; ctx.lineWidth = 3.2;
    ctx.strokeText(hit.mark,textX,textY);
    label(ctx,hit.mark,textX,textY,textSize,hit.type === 'parry' ? hit.style.color : '#ffedbc');
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
  const reduced = Boolean(settings.reduceEffects || settings.reducedEffects || reducedMotion?.matches);
  const fx = recordBattleFeedback(battle);
  if (!reduced) cameraImpulse(ctx,view,fx);
  drawBackdrop(ctx, view, battle);
  const entities = [];
  for (const e of battle.entities) {
    if (e.kind === 'field' || e.kind === 'marker') drawGroundEffect(ctx,view,e,battle.frame);
    else entities.push(e);
  }
  for (const shape of battle.telegraphs) drawTelegraph(ctx,view,shape);
  for (const spot of battle.stage?.warnings ?? []) drawSpawn(ctx,view,spot,battle.frame,reduced);
  const layers = [
    ...battle.actors.map(actor => ({y:actor.y, actor})),
    ...entities.map(entity => ({y:entity.y, entity}))
  ].sort((a,b) => a.y - b.y);
  for (const layer of layers) {
    if (layer.actor) drawActor(ctx,view,battle,layer.actor,reduced,actorContact(fx,layer.actor.id));
    else drawEntity(ctx,view,layer.entity,battle.frame,reduced);
  }
  drawHits(ctx, view, battle, fx, reduced);
  ctx.restore();
}
