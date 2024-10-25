import {
  CIRCLE_TOOL,
  IMAGE_TOOL,
  PEN_TOOL,
  RECT_TOOL,
  ROLE_TRANSLATIONS,
  RUBBER_MULTIPLIER,
  RUBBER_TOOL,
  SELECT_TOOL,
  SUPPORTED_IMAGE_FORMATS,
  TEXT_TOOL,
} from "./consts.js";
import { minVal } from "./functions.js";
import {
  currentElement,
  deleteSelectedElement,
  draw,
  editingText,
  endDrawing,
  putImageObject,
  redo,
  shiftKeyUp,
  startDrawing,
  undo,
  unselectElement,
} from "./drawing.js";
import { goToSlide } from "./navigation.js";
import {
  announceBoardNameChange,
  announceCreateSlide,
  announcePropChange,
  announceRemoveSlide,
  boardId,
  boardName,
  boardSlidesList,
  getTokenForHttpRequests,
  logoutSession,
  memberList,
  peopleOnline,
  slideId,
  watchMember,
} from "./collaboration.js";

export const canvas = document.getElementById("canvas");
export const previewDot = document.getElementById("previewDot");

const isMac = /Mac/i.test(navigator.userAgent);

export let selectedColor = "#000000";
export let selectedTool = 0;
export let selectedStrokeColor = "#000000";
export let selectedStrokeWidth = 0;
export let selectedTextSize = 24;
export let selectedOpacity = 1;
export let holdingShift = false;
export let editorLocked = true;
let isAdmin = false;

export let scaleX = 1;
export let scaleY = 1;

export const getNormalizedEventCoords = (e) => {
  return {
    x: Math.round(e.pageX * scaleX),
    y: Math.round(e.pageY * scaleY),
  };
};

const tmpStyle = document.getElementById("tmpStyle");
const styleParts = {};

const updateTemporaryStyle = () => {
  tmpStyle.innerHTML = "";
  Object.keys(styleParts).forEach((key) => {
    tmpStyle.innerHTML += styleParts[key];
  });
};

export const setActiveCategories = (categories) => {
  const selector = categories
    .map((category) => `.${category}Params`)
    .join(", ");
  styleParts.categories = `${selector} {\n\tdisplay: inline-block !important;\n}\n`;
  updateTemporaryStyle();
};

export const setTool = (number) => {
  unselectElement();

  if (previewDot?.style) {
    switch (number) {
      case SELECT_TOOL:
      case RECT_TOOL:
      case CIRCLE_TOOL:
      case IMAGE_TOOL:
      case TEXT_TOOL:
        previewDot.style.display = "none";
        break;
      case PEN_TOOL:
        previewDot.style.display = "block";
        previewDot.style.width = `${minVal(selectedStrokeWidth, 1)}px`;
        previewDot.style.height = `${minVal(selectedStrokeWidth, 1)}px`;
        break;
      case RUBBER_TOOL:
        previewDot.style.display = "block";
        previewDot.style.width = `${minVal(selectedStrokeWidth, 1) * RUBBER_MULTIPLIER}px`;
        previewDot.style.height = `${minVal(selectedStrokeWidth, 1) * RUBBER_MULTIPLIER}px`;
        break;
    }
  }

  if (number === IMAGE_TOOL) {
    openFilePicker();
  }

  selectedTool = number;
  const allTools = Array.from(document.querySelectorAll(".toolSelect"));
  allTools.forEach((tool) => {
    tool.classList.remove("currentTool");
    if (tool.id === `tool_${number}` && number !== IMAGE_TOOL) {
      tool.classList.add("currentTool");
    }
  });

  setActiveCategoriesByTool(number);
};

const openFilePicker = () => {
  document.getElementById("fileUploadInput").click();
};

const setActiveCategoriesByTool = (number) => {
  switch (number) {
    case SELECT_TOOL:
      setActiveCategories([]);
      break;
    case PEN_TOOL:
      setActiveCategories(["color", "strokeWidth", "opacity"]);
      break;
    case RECT_TOOL:
      setActiveCategories(["color", "strokeColor", "strokeWidth", "opacity"]);
      break;
    case CIRCLE_TOOL:
      setActiveCategories(["color", "strokeColor", "strokeWidth", "opacity"]);
      break;
    case RUBBER_TOOL:
      setActiveCategories(["strokeWidth", "opacity"]);
      break;
    case IMAGE_TOOL:
      setActiveCategories(["opacity"]);
      break;
    case TEXT_TOOL:
      setActiveCategories(["color", "opacity", "textSize"]);
  }
};

const onKeydownEvent = (e) => {
  const isCtrlOrCmd = isMac ? e.metaKey : e.ctrlKey;
  const isDeleteKey = e.key === "Backspace" || e.key === "Delete";

  // Undo/Redo
  if (e.key === "z" && isCtrlOrCmd && !e.shiftKey) {
    e.preventDefault();
    undo();
  } else if (e.key === "z" && isCtrlOrCmd && e.shiftKey) {
    e.preventDefault();
    redo();
  }

  // Shift-main
  else if (e.key === "Shift") {
    e.preventDefault();
    holdingShift = true;
  }

  // Delete selected object
  else if (
    isDeleteKey &&
    e.target.tagName !== "INPUT" &&
    currentElement &&
    !editingText
  ) {
    e.preventDefault();
    deleteSelectedElement();
  }

  // Pasting
  else if (e.key === "v" && isCtrlOrCmd) {
    pasteClipboard();
  }
};

const onKeyupEvent = (e) => {
  if (e.key === "Shift") {
    e.preventDefault();
    holdingShift = false;
    shiftKeyUp();
  }
};

const pasteClipboard = async () => {
  const clip = (await navigator.clipboard.read())?.[0];
  if (!clip) return;

  const imageFormats = clip.types.filter((type) =>
    SUPPORTED_IMAGE_FORMATS.includes(type),
  );
  if (imageFormats.length === 0) return;

  const blob = await clip.getType(imageFormats[0]);
  if (blob) {
    putImageObject(blob);
  }
};

export const updatePreviewDot = (e) => {
  e.preventDefault();
  const rect = canvas.getBoundingClientRect();
  previewDot.style.top = `${e.pageY}px`;
  previewDot.style.left = `${e.pageX}px`;
};

export const onCanvasResize = () => {
  scaleX = 1920 / canvas.offsetWidth;
  scaleY = 1080 / canvas.offsetHeight;
};

export const showModal = (modalId) => {
  const modal = document.getElementById(`${modalId}Modal`);
  if (modal) {
    modal.classList.remove("hidden");
  }
};

export const hideModal = () => {
  Array.from(document.querySelectorAll(".modal")).forEach((el) => {
    el.classList.add("hidden");
  });
};

export const updateMemberUI = async () => {
  const membersList = document.getElementById("membersList");
  if (!membersList) return;
  const selfUsername = localStorage.getItem("name");
  Array.from(membersList.children).forEach((el) => {
    el.remove();
  });

  const userToken = getTokenForHttpRequests();

  memberList.forEach((member) => {
    const listItem = document.createElement("li");
    console.log(member);
    listItem.innerHTML = `
      <span>${member.username}</span>
      <div class="center">
        ${member.username !== selfUsername ? `<button class="watchMemberBtn">Obserwuj</button>` : ""}
        <select class="roleSelect" ${member.username === selfUsername ? "disabled" : ""}>
          ${Object.entries(ROLE_TRANSLATIONS)
            .map(
              ([value, label]) => `
            <option value="${value}" ${parseInt(member.role) === parseInt(value) ? "selected" : ""}>${label}</option>
          `,
            )
            .join("")}
        </select>
      </div>
    `;
    membersList.appendChild(listItem);
    listItem.querySelector(".watchMemberBtn")?.addEventListener("click", () => {
      watchMember(member.username);
      hideModal();
    });
    listItem.querySelector("select").addEventListener("change", (e) => {
      fetch(`/boards/${boardId}/sharing/permissions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${userToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          matcher: member.username,
          newRole: e.target.value,
        }),
      });
    });
  });
};

export const updatePeopleCount = () => {
  document.getElementById("peopleCount").innerText = peopleOnline.toString();
};

export const updateBoardName = () => {
  const nameLbl = document.getElementById("boardName");
  nameLbl.innerText = boardName;
  if (nameLbl.offsetWidth < 4) {
    nameLbl.innerText = "Tablica bez nazwy";
  }
};

const finishBoardNameUpdate = () => {
  const nameLbl = document.getElementById("boardName");
  const nameInput = document.getElementById("boardNameInput");
  announceBoardNameChange(nameInput.value);
  nameInput.classList.add("hidden");
  nameLbl.classList.remove("hidden");
};

export const initUI = () => {
  document
    .getElementById("boardNameInput")
    .addEventListener("keypress", (e) => {
      if (e.key === "Enter") {
        finishBoardNameUpdate();
      }
    });

  document
    .getElementById("boardNameInput")
    .addEventListener("blur", finishBoardNameUpdate);

  document.getElementById("editBoardNameBtn").addEventListener("click", () => {
    prompt("Wpisz nową nazwę tablicy", boardName);
  });

  document
    .getElementById("fileUploadInput")
    .addEventListener("change", function (event) {
      const file = event.target.files[0];
      putImageObject(file);
      document.getElementById("fileUploadInput").value = "";
    });

  document.getElementById("boardName").addEventListener("click", () => {
    if (!isAdmin) return;
    const nameLbl = document.getElementById("boardName");
    const nameInput = document.getElementById("boardNameInput");
    nameInput.classList.remove("hidden");
    nameLbl.classList.add("hidden");
    nameInput.value = boardName;
    nameInput.focus();
    nameInput.select();
  });

  document.getElementById("prevSlideBtn").addEventListener("click", () => {
    const currentIndex = boardSlidesList.indexOf(slideId);
    if (currentIndex > 0) {
      goToSlide(boardId, boardSlidesList.at(currentIndex - 1));
    }
  });

  document.getElementById("nextSlideBtn").addEventListener("click", () => {
    const currentIndex = boardSlidesList.indexOf(slideId);
    if (boardSlidesList.length > currentIndex + 1) {
      goToSlide(boardId, boardSlidesList.at(currentIndex + 1));
    } else {
      announceCreateSlide();
    }
  });

  document.getElementById("deleteSlideBtn").addEventListener("click", () => {
    announceRemoveSlide(slideId);
  });

  document.getElementById("peopleBtn").addEventListener("click", () => {
    updateMemberUI().then(() => {
      showModal("people");
    });
  });

  document
    .querySelector("#peopleModal > .modalOverlay")
    .addEventListener("click", (e) => {
      if (e.target?.className === "modalOverlay") {
        hideModal();
      }
    });

  Array.from(document.querySelectorAll(".logoutBtn")).forEach((el) => {
    el.addEventListener("click", () => {
      logoutSession();
    });
  });

  window.addEventListener("resize", onCanvasResize);

  document.getElementById("opacityInput").addEventListener("input", (e) => {
    selectedOpacity = e.target?.value / 10;
    if (currentElement) {
      const el = canvas.contentDocument.getElementById(currentElement);
      el.setAttribute("opacity", selectedOpacity);
      announcePropChange(el, "opacity");
    }
  });

  document.getElementById("colorInput").addEventListener("change", (e) => {
    selectedColor = e.target?.value;
    if (currentElement) {
      const el = canvas.contentDocument.getElementById(currentElement);
      el.setAttribute("fill", selectedColor);
      announcePropChange(el, "fill");
    }
  });

  document
    .getElementById("strokeColorInput")
    .addEventListener("change", (e) => {
      selectedStrokeColor = e.target?.value;
      if (currentElement) {
        const el = canvas.contentDocument.getElementById(currentElement);
        el.setAttribute("stroke", selectedStrokeColor);
        announcePropChange(el, "stroke");
      }
    });

  document.getElementById("textSizeInput").addEventListener("input", (e) => {
    selectedTextSize = e.target?.value;
    if (currentElement) {
      const el = canvas.contentDocument.getElementById(currentElement);
      if (el.tagName === "text") {
        el.setAttribute("font-size", selectedTextSize);
        announcePropChange(el, "font-size");
      }
    }
  });

  document.getElementById("strokeWidthInput").addEventListener("input", (e) => {
    selectedStrokeWidth = e.target?.value;
    switch (selectedTool) {
      case PEN_TOOL:
        previewDot.style.width = `${minVal(selectedStrokeWidth, 1)}px`;
        previewDot.style.height = `${minVal(selectedStrokeWidth, 1)}px`;
        break;
      case RUBBER_TOOL:
        previewDot.style.width = `${minVal(selectedStrokeWidth, 1) * RUBBER_MULTIPLIER}px`;
        previewDot.style.height = `${minVal(selectedStrokeWidth, 1) * RUBBER_MULTIPLIER}px`;
        break;
    }
    if (currentElement) {
      const el = canvas.contentDocument.getElementById(currentElement);
      el.setAttribute("stroke-width", selectedStrokeWidth);
      announcePropChange(el, "stroke-width");
    }
  });

  document.getElementById("deleteElementBtn").addEventListener("click", () => {
    deleteSelectedElement();
  });

  Array.from(document.querySelectorAll(".toolSelect")).forEach((el) => {
    el.addEventListener("click", (e) => {
      let elTarget = e.target;
      if (elTarget.tagName === "IMG") elTarget = elTarget.parentElement;
      const toolId = parseInt(elTarget.id.split("_")[1]);
      setTool(toolId, true);
    });
  });

  document.addEventListener("keydown", onKeydownEvent);
  document.addEventListener("keyup", onKeyupEvent);
};

export const setIsAdminUI = (val) => {
  isAdmin = val;
  if (!val) {
    styleParts.admin = ".adminRequired {\n\tdisplay: none;\n}\n";
  } else {
    delete styleParts.admin;
  }
  updateTemporaryStyle();
};

export const setIsEditorUI = (val) => {
  editorLocked = !val;
  if (!val) {
    setTool(0);
    styleParts.editor = ".editorRequired {\n\tdisplay: none;\n}\n";
  } else {
    setTool(1);
    delete styleParts.editor;
  }
  updateTemporaryStyle();
};

export const registerCanvasEventListeners = () => {
  const target = canvas?.contentDocument;
  if (!target) return;
  target.addEventListener("mousedown", startDrawing);
  target.addEventListener("mousemove", draw);
  target.addEventListener("mousemove", updatePreviewDot);
  target.addEventListener("touchstart", startDrawing);
  target.addEventListener("touchmove", draw);
  target.addEventListener("touchend", endDrawing);
  target.addEventListener("mouseup", endDrawing);
  target.addEventListener("keydown", onKeydownEvent);
  target.addEventListener("keyup", onKeyupEvent);
};
