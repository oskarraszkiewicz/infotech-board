import {
  escapeHtml,
  hasDisallowedProperties,
  isAlphanumeric,
} from "../public/lib/functions.js";
import { colorToHex } from "./colors.js"; // Utility function to check if an array has only numeric values

// Utility function to check if an array has only numeric values
const arrayHasOnlyNumbers = (arr) => {
  if (typeof arr === "string") {
    arr = arr.split(" ");
  }
  return arr.every((v) => !Number.isNaN(parseInt(v, 10)));
};

// Utility function to validate transform property
const transformIsValid = (tr) => {
  return (
    tr === undefined ||
    /^((matrix|translate|scale|rotate|skewX|skewY)\([^\)\\'"]+\)\s*)*$/.test(tr)
  );
};

// Utility function to validate numeric values
const isValidNumber = (num) => {
  return num === undefined || !Number.isNaN(parseFloat(num));
};

// Validation function for SVG elements
export const validateSVGElement = (el) => {
  if (!el?.type) return false;

  switch (el.type) {
    case "path":
      if (
        hasDisallowedProperties(el, [
          "type",
          "d",
          "transform",
          "stroke",
          "stroke-width",
          "stroke-dasharray",
          "fill",
          "id",
          "opacity",
          "is-eraser",
        ]) ||
        !el.d ||
        !"MLl".includes(el.d.at(0)) ||
        !arrayHasOnlyNumbers(el.d.slice(1)) ||
        !el.id ||
        !isAlphanumeric(el.id) ||
        !isValidNumber(el["stroke-width"]) ||
        !transformIsValid(el.transform)
      )
        return false;
      break;
    case "rect":
      if (
        hasDisallowedProperties(el, [
          "type",
          "x",
          "y",
          "width",
          "height",
          "transform",
          "stroke",
          "stroke-width",
          "stroke-dasharray",
          "fill",
          "opacity",
          "id",
        ]) ||
        !el.id ||
        !isAlphanumeric(el.id) ||
        !isValidNumber(el.x) ||
        !isValidNumber(el.y) ||
        !isValidNumber(el.width) ||
        !isValidNumber(el.height) ||
        !isValidNumber(el["stroke-width"]) ||
        !isValidNumber(el["stroke-dasharray"]?.replaceAll(" ", "")) ||
        !transformIsValid(el.transform)
      )
        return false;
      break;
    case "ellipse":
      if (
        hasDisallowedProperties(el, [
          "type",
          "cx",
          "cy",
          "rx",
          "ry",
          "transform",
          "stroke",
          "stroke-width",
          "fill",
          "opacity",
          "id",
        ]) ||
        !el.id ||
        !isAlphanumeric(el.id) ||
        !isValidNumber(el.cx) ||
        !isValidNumber(el.cy) ||
        !isValidNumber(el.rx) ||
        !isValidNumber(el.ry) ||
        !isValidNumber(el["stroke-width"]) ||
        !transformIsValid(el.transform)
      )
        return false;
      break;
    case "image":
      if (
        hasDisallowedProperties(el, [
          "type",
          "x",
          "y",
          "width",
          "height",
          "href",
          "id",
          "transform",
          "opacity",
        ]) ||
        !el.id ||
        !el.href ||
        !el.href.startsWith("/boards/") ||
        !isValidNumber(el.x) ||
        !isValidNumber(el.y) ||
        !isValidNumber(el.width) ||
        !isValidNumber(el.height)
      )
        return false;
      break;
    case "text":
      if (
        hasDisallowedProperties(el, [
          "type",
          "text",
          "x",
          "y",
          "width",
          "height",
          "transform",
          "fill",
          "opacity",
          "font-size",
          "id",
        ]) ||
        !el.id ||
        !isAlphanumeric(el.id) ||
        !isValidNumber(el.x) ||
        !isValidNumber(el.y) ||
        !isValidNumber(el.width) ||
        !isValidNumber(el.height) ||
        !isValidNumber(el["font-size"]) ||
        !transformIsValid(el.transform)
      )
        return false;
      break;
    default:
      return false;
  }
  return true;
};

// Normalizes element properties (e.g., converts color names to hex)
export const normalizeElement = (el) => {
  if (el.stroke) el.stroke = colorToHex(el.stroke);
  if (el.fill) el.fill = colorToHex(el.fill);
  if (el.text) el.text = escapeHtml(el.text);
};
