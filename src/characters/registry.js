import { Assassin } from "./assassin.js";

export const CharacterRegistry = {
  assassin: Assassin
};

export function getCharacter(id){
  return CharacterRegistry[id] || Assassin;
}
