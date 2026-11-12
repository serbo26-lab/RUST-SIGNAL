import Phaser from 'phaser';
import { GROUND_Y, VIEW_W, VIEW_H, WORLD_W } from './core';
import { ParallaxStrip, addTileStrip } from './world-rules';

/** Original pixel-styled industrial art, generated once as Phaser textures. */
export function makeFacilityArt(scene: Phaser.Scene) {
  function paint(key: string, w: number, h: number, fn: (c:CanvasRenderingContext2D)=>void) {
    if(scene.textures.exists(key)) return;
    const t=scene.textures.createCanvas(key,w,h)!;
    const c=t.getContext();c.imageSmoothingEnabled=false;fn(c);t.refresh();
  }
  paint('fz_wall',960,540,c=>{
    const g=c.createLinearGradient(0,0,0,540);
    g.addColorStop(0,'#0a131e');g.addColorStop(.55,'#172d3d');g.addColorStop(1,'#263945');
    c.fillStyle=g;c.fillRect(0,0,960,540);
    for(let y=0;y<540;y+=93)for(let x=0;x<960;x+=160){
      c.fillStyle=(x+y)%3?'#1d3442':'#243e4a';c.fillRect(x+3,y+3,154,87);
      c.fillStyle='#344e5c';c.fillRect(x+5,y+6,148,5);c.fillStyle='#101f2a';c.fillRect(x+7,y+80,145,5);
      c.fillStyle='#637f87';for(let k=0;k<2;k++){c.fillRect(x+12+k*131,y+12,4,4);c.fillRect(x+12+k*131,y+73,4,4);}
    }
    for(let x=0;x<960;x+=240){
      c.fillStyle='#0c1925';c.fillRect(x+90,45,67,430);
      c.fillStyle='#304b57';c.fillRect(x+94,55,57,396);
      c.fillStyle='#132430';c.fillRect(x+103,79,40,336);
      c.fillStyle='#48c9be';for(let y=110;y<410;y+=39)c.fillRect(x+116,y,14,7);
      c.fillStyle='#edba70';c.fillRect(x+101,437,45,6);
    }
  });
  paint('fz_pipes',960,200,c=>{
    c.strokeStyle='#2f5560';c.lineWidth=15;
    for(let y of [40,94,147]){c.beginPath();c.moveTo(0,y);c.lineTo(960,y);c.stroke();}
    c.strokeStyle='#78a0a5';c.lineWidth=3;
    for(let y of [33,87,140]){c.beginPath();c.moveTo(0,y);c.lineTo(960,y);c.stroke();}
    for(let x=35;x<960;x+=137){c.fillStyle='#192d38';c.fillRect(x,20,23,145);
      c.fillStyle='#7ca5a3';c.fillRect(x+7,30,5,112);c.fillStyle='#f1a55e';c.fillRect(x+4,157,16,5);}
  });
  paint('fz_floor',480,100,c=>{
    c.fillStyle='#162b36';c.fillRect(0,0,480,100);
    c.fillStyle='#829da2';c.fillRect(0,0,480,5);
    c.fillStyle='#29434c';c.fillRect(0,5,480,18);
    for(let x=0;x<480;x+=40){
      c.fillStyle='#455963';c.fillRect(x+3,9,32,7);
      c.fillStyle='#192a34';c.fillRect(x+2,26,36,70);
      c.fillStyle='#607982';c.fillRect(x+8,42,22,5);
      c.fillStyle='#f4bc6b';c.fillRect(x+5,20,9,3);
    }
  });
  paint('fz_platform',140,44,c=>{
    c.fillStyle='#162b3a';c.fillRect(0,0,140,44);
    c.fillStyle='#709197';c.fillRect(0,0,140,7);
    c.fillStyle='#3c5963';c.fillRect(0,9,140,32);
    for(let x=12;x<140;x+=27){c.fillStyle='#1a303b';c.fillRect(x,11,18,26);
      c.fillStyle='#f3b76f';c.fillRect(x+5,13,7,3);}
    c.fillStyle='#142532';c.fillRect(0,39,140,5);
  });
  paint('fz_console',72,88,c=>{
    c.fillStyle='#172936';c.fillRect(6,5,60,78);
    c.fillStyle='#81949c';c.fillRect(3,0,66,11);
    c.fillStyle='#3c5762';c.fillRect(10,15,51,43);
    c.fillStyle='#1b3844';c.fillRect(14,20,43,32);
    c.fillStyle='#50ded2';c.fillRect(19,25,33,14);
    c.fillStyle='#07303b';c.fillRect(22,28,26,8);
    for(let i=0;i<4;i++){c.fillStyle=i%2?'#ffc16f':'#59d7c4';c.fillRect(18+i*9,44,5,4);}
    c.fillStyle='#263a48';c.fillRect(19,58,34,19);
    c.fillStyle='#d6a66f';c.fillRect(25,65,20,5);
    c.fillStyle='#111f2a';c.fillRect(0,82,72,6);
  });
  paint('fz_gate',68,260,c=>{
    c.fillStyle='#101e29';c.fillRect(0,0,68,260);
    c.fillStyle='#64808d';c.fillRect(5,0,58,260);
    c.fillStyle='#1f3743';c.fillRect(11,8,46,244);
    for(let y=12;y<250;y+=36){
      c.fillStyle='#334d58';c.fillRect(13,y,42,29);
      c.fillStyle='#a3bdbe';c.fillRect(13,y,42,3);
      c.fillStyle='#f1b367';c.fillRect(26,y+12,15,7);
    }
    c.fillStyle='#0d202d';c.fillRect(0,0,8,260);c.fillRect(60,0,8,260);
  });
  paint('fz_beam',22,128,c=>{
    const g=c.createLinearGradient(0,0,22,0);
    g.addColorStop(0,'rgba(248,85,102,0)');
    g.addColorStop(.48,'rgba(255,108,120,.85)');
    g.addColorStop(.52,'rgba(255,246,210,1)');
    g.addColorStop(1,'rgba(248,85,102,0)');
    c.fillStyle=g;c.fillRect(0,0,22,128);
  });
  if (scene.textures.exists('ep4_boss_core') && scene.textures.get('ep4_boss_core').has('f0')) {
    const src = scene.textures.get('ep4_boss_core');
    const img = src.getSourceImage() as CanvasImageSource;
    for (const phase of [1, 2, 3]) {
      const fr = src.get(`f${phase - 1}`);
      paint('fz_core' + phase, fr.cutWidth, fr.cutHeight, c => {
        c.drawImage(img, fr.cutX, fr.cutY, fr.cutWidth, fr.cutHeight, 0, 0, fr.cutWidth, fr.cutHeight);
      });
    }
  } else for(const phase of [1,2,3])paint('fz_core'+phase,300,238,c=>{
    c.fillStyle='#0d1c29';c.fillRect(12,74,276,157);
    c.fillStyle='#516b76';c.fillRect(20,83,260,128);
    c.fillStyle='#1a3240';c.fillRect(26,91,249,106);
    for(let x=35;x<276;x+=40){c.fillStyle='#7b9ba0';c.fillRect(x,83,8,127);}
    c.fillStyle='#0d2530';c.fillRect(73,20,153,178);
    c.fillStyle='#9db8b8';c.fillRect(80,28,140,8);
    c.fillStyle=phase===2?'#b45280':'#277783';c.fillRect(90,42,120,128);
    c.fillStyle=phase===2?'#ff6995':'#3be0d7';c.fillRect(103,56,94,93);
    c.fillStyle='#142b38';c.fillRect(119,72,63,58);
    c.fillStyle='#f7dfa5';c.fillRect(129,92,43,17);
    c.fillStyle='#183948';c.fillRect(140,97,23,8);
    for(let x of [18,250]){c.fillStyle='#0e2535';c.fillRect(x,26,32,166);c.fillStyle='#7e9ba1';c.fillRect(x+9,35,9,141);}
    c.fillStyle='#ffb669';c.font='bold 22px monospace';c.fillText('0',136,229);
    if(phase===2){c.fillStyle='#ff648e';c.fillRect(20,50,260,9);c.fillStyle='#61ffe9';c.fillRect(98,9,106,12);}
    if(phase===3){c.fillStyle='#0d1c29';c.fillRect(68,40,175,139);c.fillStyle='#bf8263';c.fillRect(110,144,90,15);c.fillStyle='#566d72';c.fillRect(50,180,204,18);}
  });
}

export class FacilityBackdrop {
  private back: ParallaxStrip;
  private pipes?: ParallaxStrip;
  constructor(scene: Phaser.Scene) {
    const hasArt = scene.textures.exists('bg_ep4');
    this.back = hasArt
      ? new ParallaxStrip(scene, 'bg_ep4', -10, -110)
      : new ParallaxStrip(scene, 'fz_wall', -65, -110);
    if (!hasArt) {
      this.pipes = new ParallaxStrip(scene, 'fz_pipes', 68, -100, 0.63);
    }
    addTileStrip(scene, 0, GROUND_Y + 37, WORLD_W, 100, 'fz_floor', -1);
    // Overhead volumetric tungsten-cyan bunker light cones along the subterranean corridor
    for (let lx = 360; lx < WORLD_W - 200; lx += 520) {
      scene.add.triangle(lx, 32, 0, 0, -120, 440, 120, 440, lx % 1040 === 360 ? 0x52dce8 : 0xffbe6b, 0.075)
        .setOrigin(0, 0).setDepth(-88);
      scene.add.rectangle(lx, 26, 46, 5, lx % 1040 === 360 ? 0x6ef6ff : 0xffcf82, 0.72)
        .setDepth(-87);
    }
  }
  update(x: number, _delta: number) {
    this.back.setScroll(x * 0.14);
    if (this.pipes) this.pipes.setScroll(x * 0.44);
  }
}
