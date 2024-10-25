import { isAlphanumeric } from "../public/lib/functions.js";
import * as path from "node:path";
import * as fs from "node:fs";

export const buildSlideLocation = (boardId, slideId) => {
  if (!isAlphanumeric(boardId) || !isAlphanumeric(slideId)) {
    return path.join("data", "boards", "undefined", `undefined.json`);
  }
  return path.join("data", "boards", boardId, `${slideId}.json`);
};

export const buildImageLocation = (boardId, imageId) => {
  if (!isAlphanumeric(boardId) || !isAlphanumeric(imageId)) {
    return path.join("data", "boards", "undefined", `undefined.png`);
  }
  return path.join("data", "boards", boardId, `${imageId}.png`);
};

export const buildBoardLocation = (boardId) => {
  if (!isAlphanumeric(boardId)) {
    return path.join("data", "boards", "undefined");
  }
  return path.join("data", "boards", boardId);
};

export const buildBoardMapLocation = (boardId) => {
  if (!isAlphanumeric(boardId)) {
    return path.join("data", "boards", "undefined", "map.json");
  }
  return path.join("data", "boards", boardId, "map.json");
};

export const ensureDataDirectory = () => {
  const dataDir = "data";
  const boardsDir = path.join(dataDir, "boards");

  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir);
  }
  if (!fs.existsSync(boardsDir)) {
    fs.mkdirSync(boardsDir);
  }
};
