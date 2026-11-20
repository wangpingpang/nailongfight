// Scenic props are painted at the back edge of each illustration. The foreground
// combat pass owns the characters, telegraphs, impacts, and UI.
const clamp = (n, low=0, high=1) => Math.max(low, Math.min(high,n));
function oval(c,x,y,rx,ry,ink) {
  c.fillStyle=ink; c.beginPath(); c.ellipse(x,y,rx,ry,0,0,Math.PI*2); c.fill();
}
function line(c,ink,width,...points) {
  c.strokeStyle=ink; c.lineWidth=width; c.beginPath(); c.moveTo(points[0],points[1]);
  for (let i=2;i<points.length;i+=2) c.lineTo(points[i],points[i+1]);
  c.stroke();
}
function panel(c,ink,...points) {
  c.fillStyle=ink; c.beginPath(); c.moveTo(points[0],points[1]);
  for (let i=2;i<points.length;i+=2) c.lineTo(points[i],points[i+1]);
  c.closePath(); c.fill();
}
function spectator(c,x,y,dir,coat,arm,headTurn=0) {
  c.save(); c.translate(x,y); c.scale(dir,1);
  oval(c,0,0,13,2.4,'#31273044');
  line(c,'#42383c',4,-4,-8,-6,0); line(c,'#42383c',4,4,-8,7,0);
  panel(c,coat,-5,-23,4,-24,8,-8,-8,-8);
  oval(c,headTurn,-30,5.1,6.4,'#d1aa80');
  panel(c,'#514249',headTurn-5,-28,headTurn-5,-35,headTurn+1,-37,headTurn+5,-33,headTurn+2,-32);
  line(c,coat,4,2,-21,7+arm*.3,-15-arm*.22,8+arm*.7,-14-arm*.45);
  c.restore();
}
function stage(c,age,x,reduced) {
  const active=age>=0 && age<112;
  const target=clamp(x??360,55,665);
  const slide=active ? reduced ? 1 : clamp(age/15) : 0;
  for(const side of [-1,1]) {
    const lamp=360+side*202, neutral=360+side*108;
    const focus=neutral+(target-neutral)*slide;
    const wash=c.createLinearGradient(0,56,0,153);
    wash.addColorStop(0,'#fff6b000'); wash.addColorStop(1,active?'#ffe2a74a':'#efca741b');
    panel(c,wash,lamp-3,36,lamp+3,36,focus+28,148,focus-28,148);
    oval(c,focus,148,28,3.5,active?'#ffe7b585':'#fbd57d20');
    for(const dx of [-17,8,29]){
      const who=360+side*(160+dx);
      spectator(c,who,145,Math.sign(target-who)||1,'#332e49',active?20:-7);
    }
  }
  if(active && age>=32 && age<78) {
    for(let i=0;i<7;i++) {
      const starX=target+(i-3)*10, starY=114-(i%3)*6;
      const glint=reduced ? 2 : 2+Math.sin((age-32)*.12+i)*1.5;
      line(c,'#fff2bd',1,starX-glint,starY,starX+glint,starY);
      line(c,'#fff2bd',1,starX,starY-glint,starX,starY+glint);
    }
  }
}
function market(c,age,reduced) {
  c.save(); c.translate(128,151);
  const sold=age>=0, fall=sold?clamp(age/19):0;
  const toe=sold?clamp((age-45)/18):0;
  spectator(c,-38,-1,1,'#67736b',sold?11:-3);
  spectator(c,27,-1,-1,'#8b563a',sold?-8:12);
  panel(c,'#7e5e46',-23,-5,23,-5,20,0,-19,0);
  line(c,'#594b3a',3,0,-6,0,-38); line(c,'#594b3a',2,-19,-35,16,-38);
  for(const x of [-17,15]){
    line(c,'#796b50',1.5,x,-35,x-9,-17,x+9,-17,x,-35);
    oval(c,x,-16,11,2.8,'#b18e54');
  }
  oval(c,-17,-20,8.3,5.5,'#5c8253');
  for(const dx of [-3,1,4])line(c,'#456b47',.9,-17+dx,-23,-18+dx,-18);
  const xp=-16+toe*37,yp=-12+fall*fall*13;
  // A red horseshoe is the only red prop here; it is kicked under the stall.
  c.save(); c.translate(xp,yp); c.rotate(reduced?0:fall*1.4+toe*.5);
  line(c,'#984634',3.4,-4,-3,-4,2,0,4,4,2,4,-3);
  line(c,'#c3baa5',2.4,-4,-4,-4,-2); line(c,'#c3baa5',2.4,4,-4,4,-2); c.restore();
  if(sold && age>=18 && age<33) for(const dx of [-1,1])line(c,'#ffe1a1',1.6,xp+dx*6,1,xp+dx*10,-4);
  if(sold && age>=44 && age<64) line(c,'#554237',3,25,-3,20-toe*10,0);
  c.restore();
}
function court(c,age) {
  const echo=age>=121 && age<235, order=age>=0 && age<235;
  for(const side of [-1,1])for(let i=0;i<3;i++){
    const x=360+side*(102+i*19);
    spectator(c,x,150,echo?-side:side,i%2?'#737457':'#76654c',echo?3:-8,echo?1.6:0);
  }
  spectator(c,404,149,-1,'#635347',order?9:-5);
  const drop=clamp((age-211)/10);
  line(c,'#393c32',1.4,395+drop*4,128+drop*14,401+drop*7,119+drop*23);
  panel(c,'#75573b',335,144,387,144,383,149,339,149);
  panel(c,'#adbd9f',349,133,369,133,366,143,353,143);
  oval(c,359,134,10,2,'#d8ddbd');
  c.save(); c.translate(359,131); c.rotate(echo?.55:0);
  oval(c,0,0,11,2.7,'#dce4c8'); oval(c,0,-2.6,2.2,2,'#799186'); c.restore();
}
function rain(c,age,reduced) {
  const active=age>=0 && age<123;
  const rush=active ? reduced ? 1 : clamp(age/17) : 0;
  spectator(c,175+rush*30,146,1,'#657c82',active?16:-5);
  for(const [i,x] of [256,463].entries()) {
    const taps=[i?24:9,i?74:61,92], since=taps.filter(t=>t<=age).at(-1);
    const pulse=active && since!=null ? clamp(1-(age-since)/15) : 0;
    const bob=reduced?0:pulse*4;
    oval(c,x,153,19,3.2,'#79acb94f');
    if(pulse>0) {
      c.strokeStyle='#acdce2'; c.lineWidth=1; c.beginPath(); c.ellipse(x,153,18+(1-pulse)*9,2+(1-pulse)*2.8,0,0,Math.PI*2); c.stroke();
    }
    spectator(c,x-11,149,1,'#5b6576',active?2:-5);
    c.save(); c.translate(x,148+bob);
    line(c,'#806957',1.7,0,-29,0,1); panel(c,'#a67b58',0,-29,-5,-4,5,-4);
    line(c,'#c19b73',1.2,0,-28,2,-5); c.restore();
  }
}
export function paintStageReaction(scene,c,view,age,worldX,reduced=false) {
  if(!['lantern-stage','melon-market','bamboo-hall','rain-tram'].includes(scene))return;
  c.save(); c.scale(view.width/720,view.height/300); c.lineCap='round'; c.lineJoin='round';
  if(scene==='lantern-stage') stage(c,age,worldX==null?360:view.x(worldX)*720/view.width,reduced);
  if(scene==='melon-market') market(c,age,reduced);
  if(scene==='bamboo-hall') court(c,age);
  if(scene==='rain-tram') rain(c,age,reduced);
  c.restore();
}
