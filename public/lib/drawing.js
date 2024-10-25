// Constants
import {
  canvas,
  editorLocked,
  getNormalizedEventCoords,
  holdingShift,
  registerCanvasEventListeners,
  scaleX,
  scaleY,
  selectedColor,
  selectedOpacity,
  selectedStrokeColor,
  selectedStrokeWidth,
  selectedTextSize,
  selectedTool,
  setActiveCategories,
  setTool,
} from "./ui.js";
import {
  announceDeleteElement,
  announceElementChange,
  announceNewElement,
  announcePropAppend,
  announcePropChange,
  boardId,
  getTokenForHttpRequests,
} from "./collaboration.js";
import {
  BOTTOM_BORDER,
  CIRCLE_TOOL,
  LEFT_BORDER,
  MIN_ELEMENT_SIZE,
  PEN_TOOL,
  RECT_TOOL,
  RIGHT_BORDER,
  RUBBER_MULTIPLIER,
  RUBBER_TOOL,
  SELECT_TOOL,
  SELECTION_BORDER,
  TEXT_TOOL,
  TOP_BORDER,
} from "./consts.js";
import {
  escapeHtml,
  generateUniqueId,
  minVal,
  unescapeHtml,
} from "./functions.js";

// History-related variables
let drawHistory = [];
let undoCount = 0;
let drawing = false;
export let currentElement = "";

// Drawing variables
let shiftX = null;
let shiftY = null;
let startX = null;
let startY = null;
let lastX = null;
let lastY = null;
let tmpProp = {};
let onUnselect = null;
const activeResizeBorders = [];
export let editingText = false;

export const putImageObject = (blob) => {
  const formData = new FormData();
  formData.append("image", blob);

  fetch(`/boards/${boardId}/upload`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${getTokenForHttpRequests()}`,
    },
    body: formData,
  }).then(async (response) => {
    const uploadResponse = await response.json();
    if (!uploadResponse?.filePath) return;
    const imageEl = canvas.contentDocument.createElementNS(
      "http://www.w3.org/2000/svg",
      "image",
    );
    currentElement = generateUniqueId();
    imageEl.setAttributeNS(
      "http://www.w3.org/1999/xlink",
      "href",
      uploadResponse.filePath,
    );
    imageEl.setAttribute("id", currentElement);
    imageEl.setAttribute("x", "0");
    imageEl.setAttribute("y", "0");
    imageEl.setAttribute("preserveAspectRatio", "none");

    canvas.contentDocument.children[0].appendChild(imageEl);

    imageEl.addEventListener("load", () => {
      let newWidth = imageEl.naturalWidth;
      let newHeight = imageEl.naturalHeight;

      const aspectRatio = imageEl.naturalWidth / imageEl.naturalHeight;

      if (newWidth > 800 || newHeight > 600) {
        if (newWidth / aspectRatio > 600) {
          newHeight = newWidth / aspectRatio;
          newWidth = 800;
          newHeight = newWidth / aspectRatio;
        } else {
          newWidth = newHeight * aspectRatio;
          newHeight = 600;
          newWidth = newHeight * aspectRatio;
        }
      }

      newWidth = Math.min(newWidth, 800);
      newHeight = Math.min(newHeight, 600);
      if (isNaN(newWidth)) newWidth = 400;
      if (isNaN(newHeight)) newHeight = 300;

      imageEl.setAttribute("width", newWidth.toString());
      imageEl.setAttribute("height", newHeight.toString());

      setTool(SELECT_TOOL);
      selectElement(imageEl);
      announceNewElement(imageEl);
    });
  });
};

const _selectTextObjectListener = (e) => {
  selectTextObject(e.target);
};

const selectTextObject = (elementPtr) => {
  const textarea = document.createElement("textarea");
  const rect = elementPtr.getBoundingClientRect();

  editingText = true;

  textarea.classList.add("textEdit");

  textarea.style.left =
    (Math.round(rect.x) || startX / scaleX).toString() + "px";
  textarea.style.top =
    (Math.round(rect.y) || startY / scaleY).toString() + "px";
  textarea.style.width = "300px";
  textarea.style.height = "200px";
  textarea.value = unescapeHtml(elementPtr.innerHTML);
  canvas.parentElement.appendChild(textarea);
  textarea.focus();
  textarea.select();

  const _textareaFocusOut = () => {
    elementPtr.innerHTML = escapeHtml(textarea.value);
    announceElementChange(elementPtr);
    textarea.remove();
    editingText = false;
  };

  textarea.addEventListener("blur", _textareaFocusOut);
  onUnselect = _textareaFocusOut;
};

const isElementPartiallyVisible = (doc, element) => {
  const elemRect = element?.getBoundingClientRect();
  return (
    elemRect &&
    !(elemRect.x + elemRect.width < 0 || elemRect.y + elemRect.height < 0)
  );
};

const reInitTmpProp = () => {
  tmpProp = {};
  tmpProp.old = {};
  tmpProp.new = {};
};

reInitTmpProp();

const removeInvisibleElements = () => {
  if (!canvas?.contentDocument) return;
  const tgtDocument = canvas.contentDocument;
  const allElements = Array.from(
    tgtDocument.querySelectorAll("svg > *"),
  ).filter((el) => el.tagName !== "style");

  allElements.forEach((el) => {
    if (!isElementPartiallyVisible(tgtDocument, el)) {
      el.remove();
      announceDeleteElement(el);
    }
  });
};

export const unselectElement = () => {
  if (currentElement !== "") {
    const selected = canvas.contentDocument?.getElementById(currentElement);
    selected?.classList.remove("selected");
    selected?.removeEventListener("click", _selectTextObjectListener);
    if (typeof onUnselect === "function") {
      onUnselect();
    }
  }
  currentElement = "";
  setActiveCategories([]);
  removeInvisibleElements();
};

const selectElement = (target) => {
  if (!target || ["svg", "path"].includes(target.tagName)) return;
  currentElement = target.id;
  target.classList.add("selected");

  switch (target.tagName) {
    case "image":
      setActiveCategories(["opacity", "delete"]);
      break;
    case "text":
      setActiveCategories(["color", "opacity", "textSize", "delete"]);
      target.addEventListener("click", _selectTextObjectListener);
      break;
    case "rect":
    case "ellipse":
      setActiveCategories([
        "color",
        "strokeColor",
        "strokeWidth",
        "opacity",
        "delete",
      ]);
      document.getElementById("colorInput").value = target.getAttribute("fill");
      document.getElementById("strokeColorInput").value =
        target.getAttribute("stroke");
      document.getElementById("strokeWidthInput").value =
        target.getAttribute("stroke-width") ?? 0;
      break;
  }

  let match = target
    .getAttribute("transform")
    ?.match(/translate\((-?\d+), (-?\d+)\)/);
  if (match) {
    lastX -= parseInt(match[1]);
    lastY -= parseInt(match[2]);
  }
};

export const handleObjectSelection = (e) => {
  console.log(e);
  const realX = e.clientX ?? e.layerX;
  const realY = e.clientY ?? e.layerY;
  let target = canvas.contentDocument?.elementsFromPoint(realX, realY)?.[0];
  if (currentElement !== "") {
    const current = canvas.contentDocument.getElementById(currentElement);
    if (current?.tagName !== "text") {
      const rect = current.getBoundingClientRect();
      const x = realX;
      const y = realY;

      if (y >= rect.y - SELECTION_BORDER && y <= rect.y) {
        activeResizeBorders.push(TOP_BORDER);
      }

      if (
        x >= rect.x + rect.width &&
        x <= rect.x + rect.width + SELECTION_BORDER
      ) {
        activeResizeBorders.push(RIGHT_BORDER);
      }

      if (
        y >= rect.y + rect.height &&
        y <= rect.y + rect.height + SELECTION_BORDER
      ) {
        activeResizeBorders.push(BOTTOM_BORDER);
      }

      if (x >= rect.x - SELECTION_BORDER && x <= rect.x) {
        activeResizeBorders.push(LEFT_BORDER);
      }
      if (activeResizeBorders.length > 0) {
        target = current;
        startX = null;
        startY = null;
      }
    }
  }
  unselectElement();
  if (target) selectElement(target);
};

export const deleteSelectedElement = () => {
  const elementToDelete = canvas.contentDocument.getElementById(currentElement);
  if (!elementToDelete) return;

  drawHistory.push(createDrawAction(currentElement));

  elementToDelete.classList.add("undo");
  elementToDelete.classList.remove("selected");

  announceDeleteElement(elementToDelete);
  unselectElement();

  currentElement = "";
};

const createDrawAction = (id, data = {}) => {
  return {
    id: id,
    data: data,
  };
};

export const shiftKeyUp = () => {
  if (drawing) {
    lastX = shiftX;
    lastY = shiftY;
  }
  shiftX = null;
  shiftY = null;
};

export const canUndo = () => {
  return drawHistory.length - undoCount > 0;
};

export const canRedo = () => {
  return undoCount !== 0;
};

export const undo = () => {
  if (!canUndo()) return;
  undoCount++;
  const action = drawHistory.at(-undoCount);
  const targetEl = canvas.contentDocument.getElementById(action.id);
  if (!targetEl) return;
  const oldProps = action.data?.old ?? {};
  if (Object.keys(oldProps).length === 0) {
    if (targetEl.classList.contains("undo")) {
      targetEl.classList.remove("undo");
      announceNewElement(targetEl, true);
    } else {
      targetEl.classList.add("undo");
      announceDeleteElement(targetEl);
    }
  } else {
    Object.entries(oldProps).forEach(([key, value]) => {
      targetEl.setAttribute(key, value);
    });
    announceElementChange(targetEl);
  }
};

export const redo = () => {
  if (!canRedo()) return;
  const action = drawHistory.at(-undoCount);
  undoCount--;
  const targetEl = canvas.contentDocument.getElementById(action.id);
  if (!targetEl) return;
  const newProps = action.data?.new ?? {};
  if (Object.keys(newProps).length === 0) {
    if (targetEl.classList.contains("undo")) {
      targetEl.classList.remove("undo");
      announceNewElement(targetEl, true);
    } else {
      targetEl.classList.add("undo");
      announceDeleteElement(targetEl);
    }
  } else {
    Object.entries(newProps).forEach(([key, value]) => {
      targetEl.setAttribute(key, value);
    });
    announceElementChange(targetEl);
  }
};

const cleanDrawHistory = () => {
  if (undoCount === 0) return;
  drawHistory = drawHistory.slice(0, -undoCount);
  Array.from(canvas.contentDocument.querySelectorAll(".undo")).forEach((el) =>
    el.remove(),
  );
  undoCount = 0;
};

export const endDrawing = (e) => {
  e.preventDefault();

  if (drawing) {
    drawing = false;
    let elementPtr = canvas.contentDocument.getElementById(currentElement);
    switch (selectedTool) {
      case PEN_TOOL:
        if (!elementPtr) {
          elementPtr = canvas.contentDocument.createElementNS(
            "http://www.w3.org/2000/svg",
            "rect",
          );
          elementPtr.id = currentElement;
          elementPtr.setAttribute("x", (startX - 1).toString());
          elementPtr.setAttribute("y", (startY - 1).toString());
          elementPtr.setAttribute("width", "1");
          elementPtr.setAttribute("height", "1");
          elementPtr.setAttribute("stroke", selectedColor);
          if (selectedStrokeWidth > 0)
            elementPtr.setAttribute("stroke-width", selectedStrokeWidth);
          elementPtr.setAttribute("fill", selectedColor);

          announceNewElement(elementPtr);
          canvas.contentDocument.children[0].appendChild(elementPtr);
        }
        break;
      case TEXT_TOOL:
        if (elementPtr) {
          setTool(SELECT_TOOL);
          const newElement = canvas.contentDocument.createElementNS(
            "http://www.w3.org/2000/svg",
            "text",
          );
          newElement.setAttribute("id", elementPtr.id);
          newElement.setAttribute("x", elementPtr.getAttribute("x"));
          newElement.setAttribute("y", elementPtr.getAttribute("y"));
          newElement.setAttribute("width", elementPtr.getAttribute("width"));
          newElement.setAttribute("height", elementPtr.getAttribute("height"));
          newElement.setAttribute("font-size", selectedTextSize);

          announceDeleteElement(elementPtr);
          elementPtr.remove();
          announceNewElement(newElement);
          canvas.contentDocument.children[0].appendChild(newElement);
          unselectElement();
          selectElement(newElement);
          selectTextObject(newElement);
        }
        break;
      case RECT_TOOL:
      case CIRCLE_TOOL:
        setTool(SELECT_TOOL);
        unselectElement();
        selectElement(elementPtr);
        break;
    }
    if (currentElement !== "") {
      cleanDrawHistory();
      const changedProps = {};
      Object.assign(changedProps, tmpProp);
      drawHistory.push(createDrawAction(currentElement, changedProps));
      if (selectedTool !== SELECT_TOOL) {
        currentElement = "";
      }
      reInitTmpProp();
      activeResizeBorders.length = 0;
    }
  }
};

export const draw = (e) => {
  e.preventDefault();
  e.stopPropagation();
  if (!drawing) return;
  getNormalizedEventCoords(e);

  let elementPtr = canvas.contentDocument.getElementById(currentElement);

  const coords = getNormalizedEventCoords(e);

  if (holdingShift && shiftX === null) {
    shiftX = coords.x;
    shiftY = coords.y;
  }

  switch (selectedTool) {
    case SELECT_TOOL:
      if (!elementPtr || !elementPtr.classList.contains("selected")) return;

      if (activeResizeBorders.length === 0) {
        if (!tmpProp.old.transform) {
          tmpProp.old.transform =
            elementPtr.getAttribute("transform") ?? "translate(0, 0)";
        }

        const diffX = coords.x - lastX;
        const diffY = coords.y - lastY;

        lastX = coords.x - diffX;
        lastY = coords.y - diffY;

        elementPtr.setAttribute("transform", `translate(${diffX}, ${diffY})`);
        tmpProp.new.transform = elementPtr.getAttribute("transform");
        announcePropChange(elementPtr, "transform");
      } else {
        if (elementPtr.tagName === "ellipse") {
          if (tmpProp.old.cx === undefined) {
            tmpProp.old.cx = parseInt(elementPtr.getAttribute("cx"));
            tmpProp.old.cy = parseInt(elementPtr.getAttribute("cy"));
            tmpProp.old.rx = parseInt(elementPtr.getAttribute("rx"));
            tmpProp.old.ry = parseInt(elementPtr.getAttribute("ry"));
          }

          if (!startX || !startY) {
            startX = coords.x;
            startY = coords.y;
            lastX = coords.x;
            lastY = coords.y;
          }

          let deltaX = coords.x - lastX;
          let deltaY = coords.y - lastY;

          if (
            activeResizeBorders.includes(LEFT_BORDER) ||
            activeResizeBorders.includes(RIGHT_BORDER)
          ) {
            if (activeResizeBorders.includes(LEFT_BORDER)) {
              deltaX *= -1;
            }
            let newRx = tmpProp.old.rx + deltaX / 2;
            if (newRx < MIN_ELEMENT_SIZE / 2) newRx = MIN_ELEMENT_SIZE / 2;
            elementPtr.setAttribute("rx", newRx.toString());
            tmpProp.new.rx = newRx;
          }

          if (
            activeResizeBorders.includes(TOP_BORDER) ||
            activeResizeBorders.includes(BOTTOM_BORDER)
          ) {
            if (activeResizeBorders.includes(TOP_BORDER)) {
              deltaY *= -1;
            }
            let newRy = tmpProp.old.ry + deltaY / 2;
            if (newRy < MIN_ELEMENT_SIZE / 2) newRy = MIN_ELEMENT_SIZE / 2;
            elementPtr.setAttribute("ry", newRy.toString());
            tmpProp.new.ry = newRy;
          }

          if (activeResizeBorders.includes(LEFT_BORDER)) {
            let newCx = tmpProp.old.cx - deltaX / 2;
            elementPtr.setAttribute("cx", newCx.toString());
            tmpProp.new.cx = newCx;
          } else if (activeResizeBorders.includes(RIGHT_BORDER)) {
            let newCx = tmpProp.old.cx + deltaX / 2;
            elementPtr.setAttribute("cx", newCx.toString());
            tmpProp.new.cx = newCx;
          }

          if (activeResizeBorders.includes(TOP_BORDER)) {
            let newCy = tmpProp.old.cy - deltaY / 2;
            elementPtr.setAttribute("cy", newCy.toString());
            tmpProp.new.cy = newCy;
          } else if (activeResizeBorders.includes(BOTTOM_BORDER)) {
            let newCy = tmpProp.old.cy + deltaY / 2;
            elementPtr.setAttribute("cy", newCy.toString());
            tmpProp.new.cy = newCy;
          }
        } else {
          if (tmpProp.old.x === undefined) {
            tmpProp.old.x = parseInt(elementPtr.getAttribute("x"));
            tmpProp.old.y = parseInt(elementPtr.getAttribute("y"));
            tmpProp.old.width = parseInt(elementPtr.getAttribute("width"));
            tmpProp.old.height = parseInt(elementPtr.getAttribute("height"));
          }

          if (!startX) {
            startX = coords.x;
            startY = coords.y;
            lastX = coords.x;
            lastY = coords.y;
          }

          let newX = tmpProp.old.x;
          let newY = tmpProp.old.y;
          let newWidth = tmpProp.old.width;
          let newHeight = tmpProp.old.height;

          if (activeResizeBorders.includes(TOP_BORDER)) {
            newY -= startY - lastY;
            newHeight += startY - lastY;
            if (newHeight < MIN_ELEMENT_SIZE) break;
          }
          if (activeResizeBorders.includes(BOTTOM_BORDER)) {
            newHeight += lastY - startY;
            if (newHeight < MIN_ELEMENT_SIZE) break;
          }
          if (activeResizeBorders.includes(LEFT_BORDER)) {
            newX += lastX - startX;
            newWidth -= lastX - startX;
            if (newWidth < MIN_ELEMENT_SIZE) break;
          }
          if (activeResizeBorders.includes(RIGHT_BORDER)) {
            newWidth += lastX - startX;
            if (newWidth < MIN_ELEMENT_SIZE) break;
          }

          elementPtr.setAttribute("x", newX.toString());
          elementPtr.setAttribute("y", newY.toString());
          elementPtr.setAttribute("width", newWidth.toString());
          elementPtr.setAttribute("height", newHeight.toString());
          tmpProp.new.x = newX;
          tmpProp.new.y = newY;
          tmpProp.new.width = newWidth;
          tmpProp.new.height = newHeight;

          lastX = coords.x;
          lastY = coords.y;
        }

        announceElementChange(elementPtr);
      }
      break;
    case PEN_TOOL:
      if (!elementPtr) {
        elementPtr = canvas.contentDocument.createElementNS(
          "http://www.w3.org/2000/svg",
          "path",
        );
        elementPtr.id = currentElement;
        elementPtr.setAttribute("d", `M${lastX} ${lastY}`);
        elementPtr.setAttribute("stroke", selectedColor);
        if (selectedStrokeWidth > 0)
          elementPtr.setAttribute("stroke-width", selectedStrokeWidth);
        elementPtr.setAttribute("fill", "none");
        elementPtr.setAttribute("opacity", selectedOpacity);

        announceNewElement(elementPtr);
        canvas.contentDocument.children[0].appendChild(elementPtr);
      }

      if (holdingShift) {
        const points = elementPtr
          .getAttribute("d")
          .slice(1)
          .split(" ")
          .slice(0, -2);
        if (points.length === 0) {
          points.push(startX, startY);
        }
        points.push(coords.x.toString(), coords.y.toString());
        shiftX = coords.x;
        shiftY = coords.y;
        elementPtr.setAttribute("d", "M" + points.join(" "));
        announcePropChange(elementPtr, "d");
      } else {
        let newX = coords.x;
        let newY = coords.y;
        const currentPath = elementPtr.getAttribute("d");
        elementPtr.setAttribute("d", `${currentPath} ${newX} ${newY}`);
        announcePropAppend(elementPtr.id, "d", ` ${newX} ${newY}`);
      }
      break;
    case TEXT_TOOL:
    case RECT_TOOL:
      if (!elementPtr) {
        elementPtr = canvas.contentDocument.createElementNS(
          "http://www.w3.org/2000/svg",
          "rect",
        );
        elementPtr.id = currentElement;
        elementPtr.setAttribute("x", lastX.toString());
        elementPtr.setAttribute("y", lastY.toString());
        if (selectedTool === RECT_TOOL) {
          elementPtr.setAttribute("stroke", selectedStrokeColor);
          elementPtr.setAttribute("opacity", selectedOpacity);
          if (selectedStrokeWidth > 0)
            elementPtr.setAttribute(
              "stroke-width",
              selectedStrokeWidth.toString(),
            );
          elementPtr.setAttribute("fill", selectedColor);
        } else {
          elementPtr.setAttribute("stroke", "black");
          elementPtr.setAttribute("stroke-width", "12");
          elementPtr.setAttribute("stroke-dasharray", "5 5");
          elementPtr.setAttribute("fill", "none");
        }

        announceNewElement(elementPtr);
        canvas.contentDocument.children[0].appendChild(elementPtr);
      }

      let offsetX = coords.x - startX;
      let offsetY = coords.y - startY;

      let newX = lastX;
      let newY = lastY;

      if (holdingShift) {
        const offset = Math.max(Math.abs(offsetX), Math.abs(offsetY));
        offsetX = offset * (offsetX < 0 ? -1 : 1);
        offsetY = offset * (offsetY < 0 ? -1 : 1);
      }

      if (coords.x - lastX < 0) {
        newX -= Math.abs(offsetX);
      }
      if (coords.y - lastY < 0) {
        newY -= Math.abs(offsetY);
      }

      elementPtr.setAttribute("x", newX.toString());
      elementPtr.setAttribute("y", newY.toString());
      elementPtr.setAttribute("width", Math.abs(offsetX).toString());
      elementPtr.setAttribute("height", Math.abs(offsetY).toString());
      announceElementChange(elementPtr);
      break;
    case CIRCLE_TOOL:
      if (!elementPtr) {
        elementPtr = canvas.contentDocument.createElementNS(
          "http://www.w3.org/2000/svg",
          "ellipse",
        );
        elementPtr.id = currentElement;
        elementPtr.setAttribute("cx", lastX.toString());
        elementPtr.setAttribute("cy", lastY.toString());
        elementPtr.setAttribute("rx", "0");
        elementPtr.setAttribute("ry", "0");
        elementPtr.setAttribute("opacity", selectedOpacity);
        elementPtr.setAttribute("stroke", selectedStrokeColor);
        if (selectedStrokeWidth > 0)
          elementPtr.setAttribute(
            "stroke-width",
            selectedStrokeWidth.toString(),
          );
        elementPtr.setAttribute("fill", selectedColor);

        announceNewElement(elementPtr);
        canvas.contentDocument.children[0].appendChild(elementPtr);
      }

      let circleX = (coords.x - startX) / 2;
      let circleY = (coords.y - startY) / 2;

      if (holdingShift) {
        const offset = Math.max(Math.abs(circleX), Math.abs(circleY));
        circleX = offset * (circleX < 0 ? -1 : 1);
        circleY = offset * (circleY < 0 ? -1 : 1);
      }

      let absX = startX + circleX;
      let absY = startY + circleY;

      if (coords.x - startX < 0) {
        absX = startX + circleX;
      }
      if (coords.y - startY < 0) {
        absY = startY + circleY;
      }

      elementPtr.setAttribute("cx", absX.toString());
      elementPtr.setAttribute("cy", absY.toString());
      elementPtr.setAttribute("rx", Math.abs(circleX).toString());
      elementPtr.setAttribute("ry", Math.abs(circleY).toString());
      announceElementChange(elementPtr);
      break;
    case RUBBER_TOOL:
      if (!elementPtr) {
        const strokeWidth = minVal(selectedStrokeWidth, 1) * RUBBER_MULTIPLIER;
        elementPtr = canvas.contentDocument.createElementNS(
          "http://www.w3.org/2000/svg",
          "path",
        );
        elementPtr.id = currentElement;
        elementPtr.setAttribute("d", `M${lastX} ${lastY}`);
        elementPtr.setAttribute("stroke", "white");
        elementPtr.setAttribute("stroke-width", strokeWidth.toString());
        elementPtr.setAttribute("fill", "none");

        announceNewElement(elementPtr);
        canvas.contentDocument.children[0].appendChild(elementPtr);
      }
      let targetX = coords.x;
      let targetY = coords.y;
      const currentPath = elementPtr.getAttribute("d");
      elementPtr.setAttribute("d", `${currentPath} ${targetX} ${targetY}`);
      announcePropAppend(elementPtr.id, "d", ` ${targetX} ${targetY}`);
      break;
  }
};

export const startDrawing = (e) => {
  e.preventDefault();
  e.stopPropagation();

  if (editorLocked) return;
  drawing = true;

  const coords = getNormalizedEventCoords(e);

  startX = coords.x;
  startY = coords.y;
  lastX = coords.x;
  lastY = coords.y;
  if (selectedTool === SELECT_TOOL) {
    handleObjectSelection(e);
  } else {
    currentElement = generateUniqueId();
  }
};

export const loadSVGFromJSON = (
  data,
  afterLoad = null,
  targetCanvas = null,
) => {
  const canvas = targetCanvas ?? document.getElementById("canvas");
  canvas.data = "";
  canvas.onload = () => {
    if (canvas.data === "") return;
    canvas.onload = null;

    data.svgData?.elements?.forEach((element) => {
      const newElement = document.createElementNS(
        "http://www.w3.org/2000/svg",
        element.type,
      );
      Object.keys(element).forEach((key) => {
        if (key === "type" || key === "text") return;
        newElement.setAttribute(key, element[key]);
      });
      canvas.contentDocument.children[0].appendChild(newElement);
      if (element.type === "image") {
        newElement.setAttribute("preserveAspectRatio", "none");
      }
      if (element.type === "text") {
        newElement.innerHTML = escapeHtml(element.text) ?? "";
      }
    });

    registerCanvasEventListeners();
    if (afterLoad) afterLoad(data);
  };
  canvas.data = "assets/empty.svg";
};
