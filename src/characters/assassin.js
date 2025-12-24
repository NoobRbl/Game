export const Assassin = {
  id: "assassin",
  name: "Assassin",
  sheet: "/assets/characters/assassin/sheet.png",

  // spritesheet grid config
  sheetGrid: { fw: 128, fh: 128, cols: 8 },

  stats: {
    hpMin: 20109, hpMax: 36098,
    dmgMin: 271, dmgMax: 399,
    critMin: 400, critMax: 418,
    critChance: 0.15,

    move: 680,
    jump: 1080,
    dash: 2100
  },

  // animation clips: frame index (grid)
  anim: {
    idle: { frames:[0,1,2,3], fps:8, loop:true },
    run:  { frames:[8,9,10,11,12,13], fps:14, loop:true },
    jump: { frames:[16,17,18], fps:12, loop:false },
    fall: { frames:[19,20], fps:10, loop:true },

    atk1: { frames:[24,25,26,27], fps:18, loop:false },
    atk2: { frames:[28,29,30,31], fps:18, loop:false },
    atk3: { frames:[32,33,34,35], fps:18, loop:false },

    s1:   { frames:[40,41,42,43,44], fps:20, loop:false },
    s2:   { frames:[48,49,50,51,52], fps:20, loop:false },
    sub:  { frames:[56,57,58], fps:18, loop:false },
    ult:  { frames:[64,65,66,67,68,69,70], fps:22, loop:false },

    stun: { frames:[72,73], fps:10, loop:true },
    dead: { frames:[74,75,76], fps:10, loop:false }
  },

  stateToAnim(state, combo){
    if(state === "atk") return ["atk1","atk2","atk3"][combo] || "atk1";
    if(state === "s1") return "s1";
    if(state === "s2") return "s2";
    if(state === "sub") return "sub";
    if(state === "ult") return "ult";
    return state; // idle/run/jump/fall/stun/dead
  }
};
