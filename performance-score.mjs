// Times are 60 Hz presentation frames. SFX and captions follow committed match time.
export const courierLine = '线路刚铺好，终点先别走！';
export const doorCue = 'door-keeper';
export const doorSheetId = 'echo.glider.route';
export const clipPath = name => './assets/audio/performance/' + name + '.mp3';

const beat = (at, cue, gain, caption = '', hold = 0, pan = 0) => ({at,cue,gain,caption,hold,pan});
export const stageScores = {
  'lantern-stage': {
    trigger:'miss', beats:[beat(8,'drum-fill',.32),beat(32,'ovation',.19)]
  },
  'melon-market': {
    trigger:'down',
    intro:[beat(1,'brake',.19),beat(8,'market-ask',.43,'买主：两只瓜，怎么只称出一只？',67),
      beat(76,'market-pledge',.45,'摊主：这秤每次只听一个人的。',88)],
    beats:[beat(19,'magnet',.35),beat(38,'market-backpedal',.41,'摊主：怪了，秤砣也下班了。',108)]
  },
  'bamboo-hall': {
    trigger:'hit', beats:[beat(8,'porcelain',.26),beat(16,'court-order',.43,'主审：请把证物递上来。',104),
      beat(121,'court-echo',.42,'书记：茶盏要求先喝口茶。',114),beat(221,'brush',.22)]
  },
  'rain-tram': {
    trigger:'double-miss', beats:[beat(0,'rain-stop',.41,'站务员：车还没到，谁先起的步？',45),
      beat(9,'puddle',.21,'',0,-.55),beat(24,'puddle',.21,'',0,.55),
      beat(47,'rain-count',.43,'站务员：原来是水坑在打拍子。',77),beat(92,'basin',.27)]
  }
};
export const performanceClips = [...new Set([doorCue, ...Object.values(stageScores).flatMap(
  score => [...(score.intro || []), ...score.beats].map(b => b.cue))])];

export function currentStory(battle) {
  const score = stageScores[battle.sceneId ?? battle.config.defaultScene];
  const reaction = battle.performance?.reaction;
  if (!score || reaction?.interrupted) return null;
  const age = reaction ? battle.frame - reaction.frame : battle.frame;
  const beats = reaction ? score.beats : score.intro;
  return beats ? {age:Math.floor(age * 60 / battle.config.rules.tickRate), beats} : null;
}

export function doorPose(age, tickRate = 60) {
  const t = age * 60 / tickRate;
  if (t < 0 || t >= 120) return null;
  if (t < 30) return 0;
  if (t < 68) return 1;
  return t < 101 ? 2 : 3;
}
