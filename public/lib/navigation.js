import { canvas, onCanvasResize, showModal } from "./ui.js";
import { loadSVGFromJSON } from "./drawing.js";
import {
  announceCreateSlide,
  boardId,
  boardSlidesList,
  getTokenForHttpRequests,
  setChangeId,
  setEmitLock,
  slideId,
} from "./collaboration.js";

export const goToSlide = (boardId, slideId) => {
  window.location.hash = `${boardId}:${slideId}`;
};

export const reloadSlide = (callback = null) => {
  if (!boardId) return;
  if (!slideId || slideId === "undefined") {
    if (boardSlidesList.length === 0)
      announceCreateSlide({ onlyIfEmpty: true });
    else goToSlide(boardId, boardSlidesList.at(0));
    return;
  }

  document.getElementById("csiCurrent").innerText = (
    boardSlidesList.indexOf(slideId) + 1
  ).toString();

  setEmitLock(true);

  Array.from(document.querySelectorAll(".currentSlide")).forEach((slide) => {
    slide.classList.remove("currentSlide");
  });

  document.getElementById(`link_${slideId}`)?.classList.add("currentSlide");

  const undoList = Array.from(
    canvas.contentDocument?.querySelectorAll(".undo") || [],
  )?.map((el) => el.id);
  const afterLoad = (data) => {
    undoList.forEach((id) => {
      canvas.contentDocument.getElementById(id)?.classList.add("undo");
    });

    setChangeId(data.changeId);
    onCanvasResize();

    setEmitLock(false);
    if (callback) callback();
  };

  const userToken = getTokenForHttpRequests();
  fetch(`boards/${boardId}/${slideId}`, {
    headers: { Authorization: `Bearer ${userToken}` },
  })
    .then((response) => {
      if (response.status === 403) {
        showModal("authFailed");
      } else {
        return response.json();
      }
    })
    .then(async (jsonData) => {
      await loadSVGFromJSON(jsonData, afterLoad);
    });
};
