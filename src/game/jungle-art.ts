import Phaser from 'phaser';
import { VIEW_W, VIEW_H, WORLD_W, GROUND_Y } from './core';
import { ParallaxStrip, addTileStrip } from './world-rules';

/** Hand-authored procedural pixel textures for Episode 3's alien rainforest.
 * Generated exactly once; every parallax layer uses repeatable tiles. */
export function makeJungleArt(scene: Phaser.Scene) {
  function texture(name: string, w: number, h: number, draw: (c: CanvasRenderingContext2D) => void) {
    if (scene.textures.exists(name)) return;
    const t = scene.textures.createCanvas(name, w, h)!;
    const c = t.getContext(); c.imageSmoothingEnabled = false; draw(c); t.refresh();
  }
  texture('jg_sky', 1200, 540, c => {
    const g = c.createLinearGradient(0, 0, 0, 540);
    for (const [stop, color] of [[0,'#07131e'],[0.4,'#173b3d'],[0.72,'#4a6556'],[1,'#a1a179']] as Array<[number,string]>) g.addColorStop(stop, color);
    c.fillStyle = g; c.fillRect(0, 0, 1200, 540);
    c.fillStyle='#b5e9ac'; c.beginPath(); c.arc(870,145,64,0,Math.PI*2); c.fill();
    c.fillStyle='#b5ebd3'; c.globalAlpha=.24; c.beginPath(); c.arc(870,145,100,0,Math.PI*2); c.fill(); c.globalAlpha=1;
    let seed=92345; const rnd=() => {seed=(seed*1664525+1013904223)>>>0; return seed/4294967296;};
    for(let i=0;i<90;i++){c.fillStyle=i%4===0?'#e0edac':'#79d7bc';c.globalAlpha=.22+rnd()*.35;c.fillRect(rnd()*1200,rnd()*275,1+rnd()*2,2); }
    c.globalAlpha=1;
    c.fillStyle='#142f33'; c.beginPath();c.moveTo(0,450);
    for(let x=0;x<=1200;x+=55)c.lineTo(x,325+30*Math.sin(x*.013)+35*Math.cos(x*.007));
    c.lineTo(1200,540);c.lineTo(0,540);c.fill();
    c.fillStyle='#0d2531';c.beginPath();c.moveTo(0,510);
    for(let x=0;x<=1200;x+=31)c.lineTo(x,397+24*Math.sin(x*.03)+18*Math.cos(x*.011));
    c.lineTo(1200,540);c.lineTo(0,540);c.fill();
  });
  texture('jg_canopy', 1200, 440, c => {
    let seed=112347;const rnd=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};
    for(let n=0;n<22;n++){
      const x=n*61+rnd()*25,y=180+rnd()*85;
      c.fillStyle=n%2?'#0b3532':'#164842';c.fillRect(x-9,y,18,440-y);
      c.strokeStyle='#1f5650';c.lineWidth=3;
      c.beginPath();c.moveTo(x,y);c.lineTo(x+30,y-65);c.stroke();
      for(let a=0;a<7;a++){
        const ax=x-90+rnd()*180,ay=y-55+rnd()*78;
        c.fillStyle=a%2?'#255a50':'#1d4b47';
        c.beginPath();c.ellipse(ax,ay,52+rnd()*33,25+rnd()*27,rnd(),0,Math.PI*2);c.fill();
        c.fillStyle='#307369';c.fillRect(ax-10,ay-2,22,4);
      }
      c.strokeStyle='#367568'; c.lineWidth=2;
      c.beginPath();c.moveTo(x+10,y-25);
      c.bezierCurveTo(x+35,y+8,x+15,y+62,x+45,y+96);c.stroke();
    }
  });
  texture('jg_foreground', 960, 230, c => {
    let seed=31326;const rnd=()=>{seed=(seed*1103515245+12345)>>>0;return seed/4294967296;};
    for(let x=0;x<960;x+=70){
      c.fillStyle='#0b2929';c.fillRect(x,112,12+rnd()*13,118);
      c.fillStyle='#15453c';c.beginPath();c.ellipse(x+3,103,40,75,.7,0,Math.PI*2);c.fill();
      c.fillStyle='#1c5142';c.beginPath();c.ellipse(x+20,115,40,36,-.5,0,Math.PI*2);c.fill();
      c.fillStyle='#5c9b72';c.fillRect(x+25,99,5,16);
    }
    c.strokeStyle='#52a890';c.lineWidth=2;
    for(let x=10;x<960;x+=104){
      c.beginPath();c.moveTo(x,0);c.bezierCurveTo(x-40,33,x+64,71,x+14,130);c.stroke();
    }
  });
  texture('jg_ground', 480, 95, c => {
    c.fillStyle='#1d2e2e';c.fillRect(0,0,480,95);
    c.fillStyle='#507366';c.fillRect(0,0,480,9);
    c.fillStyle='#759e77';c.fillRect(0,0,480,3);
    c.fillStyle='#293d35';c.fillRect(0,9,480,32);
    for(let i=0;i<48;i++){
      const x=i*10;
      c.fillStyle=i%3===0?'#6aa278':'#355d54';c.fillRect(x,9+i%7,7,3);
      c.fillStyle=i%4===0?'#162723':'#41574d';c.fillRect(x,43+i%12,12,4);
      c.fillStyle='#65765c';if(i%5===0)c.fillRect(x+6,22,3,19);
    }
    c.fillStyle='#18262d';c.fillRect(0,75,480,20);
  });
  texture('jg_platform', 132, 42, c => {
    c.fillStyle='#354b47';c.fillRect(0,0,132,42);
    c.fillStyle='#79ad80';c.fillRect(0,0,132,9);
    c.fillStyle='#466758';c.fillRect(4,10,124,28);
    for(let x=5;x<132;x+=21){c.fillStyle='#253b37';c.fillRect(x,15,8,22);c.fillStyle='#acc58c';c.fillRect(x+4,4,7,3);}
    c.fillStyle='#162c31';c.fillRect(0,37,132,5);
  });
  texture('jg_growth', 70, 88, c => {
    c.fillStyle='#182c2c';c.fillRect(27,41,15,47);c.fillStyle='#56866d';c.fillRect(31,51,8,35);
    c.fillStyle='#317769';c.beginPath();c.ellipse(35,34,30,35,0,0,Math.PI*2);c.fill();
    c.fillStyle='#1b4b49';c.beginPath();c.ellipse(34,35,24,29,0,0,Math.PI*2);c.fill();
    c.fillStyle='#8ae9a6';c.beginPath();c.ellipse(33,33,13,18,0,0,Math.PI*2);c.fill();
    c.fillStyle='#c1f5a6';c.fillRect(28,25,9,13);
    c.strokeStyle='#77ac79';c.lineWidth=4;
    for(const d of [-1,1]){c.beginPath();c.moveTo(35,67);c.quadraticCurveTo(35+d*52,50,35+d*31,20);c.stroke();}
  });
  texture('jg_spore', 42, 42, c => {
    c.fillStyle='#b7fb89';c.globalAlpha=.2;c.beginPath();c.arc(21,21,20,0,Math.PI*2);c.fill();c.globalAlpha=1;
    c.fillStyle='#b0f786';c.beginPath();c.arc(21,21,12,0,Math.PI*2);c.fill();
    c.fillStyle='#568f83';c.beginPath();c.arc(21,21,7,0,Math.PI*2);c.fill();
    c.fillStyle='#f8f9bb';c.fillRect(20,13,3,6);
  });
  texture('jg_stalker', 54, 48, c => {
    c.fillStyle='#17463d';c.fillRect(11,15,32,26);
    c.fillStyle='#51875f';c.fillRect(6,21,41,18);c.fillStyle='#b5d780';c.fillRect(18,17,22,6);
    c.fillStyle='#adf5a0';c.fillRect(35,24,7,6);
    c.fillStyle='#162e2d';c.fillRect(12,38,10,10);c.fillRect(31,38,10,10);
    c.fillStyle='#2b594d';c.fillRect(0,27,11,10);c.fillRect(41,31,12,7);
    c.fillStyle='#85ac68';c.fillRect(27,7,14,12);
  });
  if (scene.textures.exists('ep3_boss_heart') && scene.textures.get('ep3_boss_heart').has('f0')) {
    const src = scene.textures.get('ep3_boss_heart');
    const img = src.getSourceImage() as CanvasImageSource;
    for (const phase of [1, 2, 3]) {
      const fr = src.get(`f${phase - 1}`);
      texture('jg_heart' + phase, fr.cutWidth, fr.cutHeight, c => {
        c.drawImage(img, fr.cutX, fr.cutY, fr.cutWidth, fr.cutHeight, 0, 0, fr.cutWidth, fr.cutHeight);
      });
    }
  } else for (const phase of [1,2,3]) texture('jg_heart'+phase, 284, 246, c => {
    c.fillStyle='#183b38';c.fillRect(102,155,65,82);
    c.fillStyle='#497c66';c.fillRect(119,167,42,69);
    for(let i=0;i<8;i++){
      const a=i*Math.PI/4;const x=141+Math.cos(a)*106,y=126+Math.sin(a)*86;
      c.strokeStyle=phase===2?'#8c6374':'#2a655b';c.lineWidth=11;
      c.beginPath();c.moveTo(141,126);c.quadraticCurveTo(141+Math.cos(a)*83,126+Math.sin(a)*52,x,y);c.stroke();
      c.fillStyle=i%2?'#3c7465':'#60947a';c.beginPath();c.ellipse(x,y,20,34,a,0,Math.PI*2);c.fill();
    }
    c.fillStyle='#133632';c.beginPath();c.ellipse(141,129,84,101,0,0,Math.PI*2);c.fill();
    c.fillStyle=phase===2?'#b85e81':'#397f71';
    c.beginPath();c.ellipse(141,122,64,79,0,0,Math.PI*2);c.fill();
    c.fillStyle=phase===2?'#f0859e':'#89d58e';
    c.beginPath();c.ellipse(141,120,48,60,0,0,Math.PI*2);c.fill();
    c.fillStyle='#183a38';c.beginPath();c.ellipse(141,115,36,41,0,0,Math.PI*2);c.fill();
    c.fillStyle=phase===2?'#fff0be':'#b1f1af';
    c.fillRect(122,104,40,18);c.fillStyle='#224e44';c.fillRect(132,108,20,10);
    c.fillStyle='#f1d7ac';c.fillRect(130,109,8,7);
    if(phase===2){
      c.fillStyle='#f48bac';c.fillRect(81,102,16,41);c.fillRect(189,91,12,46);
      c.fillStyle='#75f7d2';c.fillRect(117,54,44,11);
    }
    if(phase===3){
      c.fillStyle='#172b30';c.fillRect(60,60,166,118);
      c.fillStyle='#d27c66';c.fillRect(110,150,79,9);
      c.fillStyle='#3c5b51';c.fillRect(81,180,118,40);
    }
  });
}

/** Fixed-camera sky + independent camera-parallax vines and ground; hide none
 * of the actor hitboxes or the important warning markers. */
export class JungleBackdrop {
  private sky: ParallaxStrip;
  private canopy?: ParallaxStrip;
  private motes?: ParallaxStrip;
  private driftX = 0;
  private driftY = 0;
  constructor(scene: Phaser.Scene) {
    if (!scene.textures.exists('jg_motes')) {
      const t = scene.textures.createCanvas('jg_motes', 960, 540)!;
      const c = t.getContext();
      let seed = 7711; const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
      for (let i = 0; i < 64; i++) {
        const mx = rnd() * 960, my = rnd() * 540, r = 1.4 + rnd() * 2.4;
        c.fillStyle = i % 3 === 0 ? 'rgba(130, 255, 175, 0.48)' : 'rgba(205, 255, 145, 0.38)';
        c.beginPath(); c.arc(mx, my, r, 0, Math.PI * 2); c.fill();
      }
      t.refresh();
    }
    const hasArt = scene.textures.exists('bg_ep3');
    this.sky = hasArt
      ? new ParallaxStrip(scene, 'bg_ep3', -10, -110)
      : new ParallaxStrip(scene, 'jg_sky', -80, -110);
    if (!hasArt) {
      this.canopy = new ParallaxStrip(scene, 'jg_canopy', 70, -100, 0.76);
    }
    // Chunked static TileSprite at depth -85 keeps smooth scrollFactor parallax without per-frame canvas repaints.
    const fgSpan = Math.min(WORLD_W, Math.ceil((WORLD_W - 1280) * 0.28 + 1280));
    addTileStrip(scene, 0, 40, fgSpan, 230, 'jg_foreground', -85, hasArt ? 0.25 : 0.42, hasArt ? 0.28 : 0.43);
    this.motes = new ParallaxStrip(scene, 'jg_motes', 0, 75, 0.72, true);
    addTileStrip(scene, 0, GROUND_Y + 36, WORLD_W, 95, 'jg_ground', -1);
  }
  update(cameraX: number, delta: number) {
    this.driftX += delta * 0.015;
    this.driftY += delta * 0.025;
    this.sky.setScroll(cameraX * 0.08);
    if (this.canopy) this.canopy.setScroll(cameraX * 0.27);
    if (this.motes) this.motes.setScroll(cameraX * 0.6 + this.driftX, this.driftY);
  }
}
