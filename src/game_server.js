// src/game_server.js
// File này chỉ để server (Node.js) import lại toàn bộ logic game từ src/game.js
// Vì server.js đang: import { createGameState, stepGame } from "./src/game_server.js";

export { createGameState, stepGame } from "./game.js";
