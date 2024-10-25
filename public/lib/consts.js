export const CREATOR_ROLE = 0;
export const EDITOR_ROLE = 1;
export const GUEST_ROLE = 2;
export const NO_ROLE = 3;

export const ROLE_TRANSLATIONS = {
  0: "Właściciel",
  1: "Edytor",
  // 4: "Edytor slajdu",
  2: "Gość",
  3: "Brak dostępu",
};

export const SELECT_TOOL = 0;
export const PEN_TOOL = 1;
export const RECT_TOOL = 2;
export const CIRCLE_TOOL = 3;
export const RUBBER_TOOL = 4;
export const TEXT_TOOL = 5;
export const IMAGE_TOOL = 6;

export const SELECTION_BORDER = 12;
export const RUBBER_MULTIPLIER = 64;

export const TOP_BORDER = 0;
export const RIGHT_BORDER = 1;
export const BOTTOM_BORDER = 2;
export const LEFT_BORDER = 3;

export const MIN_ELEMENT_SIZE = 1;
export const SUPPORTED_IMAGE_FORMATS = [
  "image/png",
  "image/jpeg",
  "image/webp",
];
