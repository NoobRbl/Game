export class Animator {
  constructor(animDef){
    this.animDef = animDef;
    this.clip = "idle";
    this.t = 0;
    this.i = 0;
  }
  set(name){
    if(this.clip === name) return;
    this.clip = name;
    this.t = 0;
    this.i = 0;
  }
  update(dt){
    const c = this.animDef[this.clip] || this.animDef.idle;
    const fps = c.fps || 10;
    const frames = c.frames || [0];
    const spf = 1 / fps;

    this.t += dt;
    while(this.t >= spf){
      this.t -= spf;
      this.i++;
      if(this.i >= frames.length){
        this.i = c.loop ? 0 : frames.length - 1;
      }
    }
  }
  frame(){
    const c = this.animDef[this.clip] || this.animDef.idle;
    const frames = c.frames || [0];
    return frames[this.i] ?? 0;
  }
}
