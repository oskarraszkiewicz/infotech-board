import {
  canvas,
  hideModal,
  setIsAdminUI,
  setIsEditorUI,
  showModal,
  updateBoardName,
  updatePeopleCount,
} from "./ui.js";
import { escapeHtml, generateUniqueId, getElementAttrs } from "./functions.js";
import { goToSlide, reloadSlide } from "./navigation.js";
import { CREATOR_ROLE, EDITOR_ROLE, NO_ROLE } from "./consts.js";

let socket;
const syncQueue = [];
let firstConnection = true;
let emitLocked = false;
let lastChangeId = 0;
export let boardName = "";
export let peopleOnline = 0;
export let memberList = [];
export let userRole = NO_ROLE;
export let boardSlidesList = [];
export let boardId = "";
export let slideId = "";

export const logoutSession = () => {
  localStorage.clear();
  window.location.reload();
};

export const setChangeId = (val) => {
  lastChangeId = val;
};

export const setEmitLock = (val) => {
  emitLocked = val;
};

export const watchMember = (id) => {
  socket.emit("watchMember", id);
};

export const announceBoardNameChange = (newName) => {
  socket.emit("changeBoardName", newName);
};

export const announceCreateSlide = (params = {}) => {
  socket.emit("createSlide", params);
};

export const announceRemoveSlide = (targetSlideId) => {
  socket.emit("removeSlide", targetSlideId);
};

export const announceNewElement = (element) => {
  const elEvent = {
    type: "addElement",
    element: {
      type: element.tagName.toLowerCase(),
      ...getElementAttrs(element),
    },
  };

  syncQueue.push(elEvent);
  syncChange();
};

export const announceDeleteElement = (element) => {
  const elEvent = { type: "deleteElement", elementId: element.id };
  syncQueue.push(elEvent);
  syncChange();
};

export const announceElementChange = (element) => {
  const elEvent = {
    type: "modifyElement",
    element: {
      type: element.tagName.toLowerCase(),
      ...getElementAttrs(element),
    },
  };
  syncQueue.push(elEvent);
  syncChange();
};

export const announcePropChange = (element, propKey) => {
  const elEvent = {
    type: "modifyElementProp",
    elementId: element.id,
    propKey,
    propValue: element.getAttribute(propKey),
  };
  syncQueue.push(elEvent);
  syncChange();
};

export const announcePropAppend = (elementId, propKey, appendStr) => {
  const elEvent = {
    type: "appendElementProp",
    elementId: elementId,
    propKey,
    appendStr,
  };
  syncQueue.push(elEvent);
  syncChange();
};

export const getTokenForHttpRequests = () => {
  const storedToken = localStorage.getItem("token");
  if (localStorage.getItem("name").includes("@")) {
    return `google-${storedToken}`;
  }
  return storedToken;
};

export const authenticate = (afterAuth) => {
  setIsEditorUI(false);
  setIsAdminUI(false);

  const savedToken = localStorage.getItem("token") ?? "";
  if (savedToken !== "") {
    afterAuth();
    return;
  }

  showModal("auth");
  document.body.classList.add("loggedOut");

  const authUsername = document.getElementById("authUsername");
  const logAsGuest = document.getElementById("logAsGuest");
  const logWithGoogle = document.getElementById("logWithGoogle");
  authUsername.addEventListener("input", (e) => {
    logAsGuest.disabled = e.target.value === "";
  });

  const logIn = () => {
    if (afterAuth) afterAuth();

    hideModal();
    document.body.classList.remove("loggedOut");
  };

  authUsername.addEventListener("keypress", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      logAsGuest.click();
    }
  });

  logAsGuest.addEventListener("click", () => {
    localStorage.setItem("token", generateUniqueId(48));
    localStorage.setItem("name", authUsername.value);
    logIn();
  });

  logWithGoogle.addEventListener("click", () => {
    const popup = window.open("/auth/google", "_blank");

    const pollTimer = window.setInterval(() => {
      if (popup.closed) {
        window.clearInterval(pollTimer);
        logIn();
      }
    }, 100);
  });
};

const syncChange = (notifySelf = false) => {
  if (emitLocked) return;
  const change = syncQueue[0];
  if (!change) return;

  emitLocked = true;

  if (!notifySelf) notifySelf = undefined;

  switch (change.type) {
    case "addElement":
      socket.emit("addElement", {
        changeId: lastChangeId,
        element: change.element,
        notifySelf,
      });
      break;
    case "modifyElement":
      socket.emit("modifyElement", {
        changeId: lastChangeId,
        element: change.element,
        notifySelf,
      });
      break;
    case "appendElementProp":
      socket.emit("appendElementProp", {
        changeId: lastChangeId,
        elementId: change.elementId,
        propKey: change.propKey,
        appendStr: change.appendStr,
        notifySelf,
      });
      break;
    case "deleteElement":
      socket.emit("deleteElement", {
        changeId: lastChangeId,
        elementId: change.elementId,
        notifySelf,
      });
      break;
    case "modifyElementProp":
      socket.emit("modifyElementProp", {
        changeId: lastChangeId,
        elementId: change.elementId,
        propKey: change.propKey,
        propValue: change.propValue,
        notifySelf,
      });
      break;
  }
};

export const connectToSocket = (queryData = {}) => {
  document.body.classList.remove("loggedOut");

  socket = io({ query: queryData });
  socket.on("connect_error", (err) => {
    if (err.message === "authentication failed") showModal("authFailed");
  });
  socket.on("connect", () => {
    if (!firstConnection) {
      if (boardId) socket.emit("joinBoard", boardId);
      if (slideId) socket.emit("switchedSlide", slideId);
      reloadSlide(syncChange);
    }
    firstConnection = false;

    const refreshHash = () => {
      const hash = window.location.hash.slice(1).split(":");

      Array.from(document.querySelectorAll(".currentSlide")).forEach(
        (slide) => {
          slide.classList.remove("currentSlide");
        },
      );

      slideId = "";
      switch (hash.length) {
        case 1:
          if (boardId !== hash[0]) {
            boardId = hash[0];
            socket.emit("joinBoard", boardId);
            socket.emit("switchedSlide", "");
          } else {
            slideId = "";
            socket.emit("switchedSlide", "");
          }
          break;
        case 2:
          if (boardId !== hash[0]) {
            boardId = hash[0];
            slideId = hash[1];
            socket.emit("joinBoard", boardId);
            socket.emit("switchedSlide", slideId);
          } else if (slideId !== hash[1]) {
            slideId = hash[1];
            socket.emit("switchedSlide", slideId);
          }
          break;
      }

      if (boardId === "") {
        socket.emit("startNew", null);
      }

      reloadSlide();
    };

    const setHash = (boardId, slideId) => {
      window.location.hash = `#${boardId}:${slideId}`;
    };
    refreshHash();
    window.addEventListener("hashchange", refreshHash);

    socket.on("slideDeleted", () => {
      const indexOfSlide = boardSlidesList.indexOf(slideId);
      if (indexOfSlide !== -1 && boardSlidesList.length > 1) {
        switch (indexOfSlide) {
          case 0:
            setHash(boardId, boardSlidesList.at(indexOfSlide + 1));
            break;
          default:
            setHash(boardId, boardSlidesList.at(indexOfSlide - 1));
            break;
        }
      } else {
        setHash(boardId);
      }
    });

    socket.on("createdBoard", (message) => {
      setHash(message.boardId);
    });

    socket.on("roleUpdated", (roleId) => {
      userRole = roleId;
      setIsAdminUI(userRole === CREATOR_ROLE);
      setIsEditorUI(userRole <= EDITOR_ROLE);
    });

    socket.on("needsReload", () => {
      syncChange();
    });

    socket.on("syncCompleted", (changeId) => {
      if (syncQueue.length > 0) {
        syncQueue.splice(0, 1);
      }

      emitLocked = false;
      lastChangeId = changeId;
      syncChange();
    });

    socket.on("updateMembersList", ({ members, userCount }) => {
      peopleOnline = userCount;
      memberList = members;
      updatePeopleCount();
    });

    socket.on("slidesListUpdate", (slides) => {
      let currentSlideNum = slides.indexOf(slideId) + 1;
      let slideCount = slides.length;
      boardSlidesList = slides;

      document.getElementById("csiCurrent").innerText = currentSlideNum;
      document.getElementById("csiMax").innerText = slideCount.toString();

      if (slideCount === 0) {
        socket.emit("createSlide", { onlyIfEmpty: true });
      } else if (currentSlideNum === 0) {
        goToSlide(boardId, boardSlidesList[0]);
      }
    });

    socket.on("boardNameUpdate", (newName) => {
      boardName = newName;
      updateBoardName();
    });

    socket.on(
      "newElement",
      ({ slideId: changeSlideId, changeId, elementData }) => {
        if (slideId !== changeSlideId) return;

        if (changeId !== ++lastChangeId) {
          reloadSlide(() => syncChange(true));
          return;
        }
        const newElement = document.createElementNS(
          "http://www.w3.org/2000/svg",
          elementData.type,
        );
        Object.keys(elementData).forEach((key) => {
          if (key === "type") return;
          newElement.setAttribute(key, elementData[key]);
        });
        if (elementData.type === "image") {
          newElement.setAttribute("preserveAspectRatio", "none");
        }

        const svgEl = canvas.contentDocument.querySelector("svg");
        svgEl.appendChild(newElement);
      },
    );

    socket.on(
      "elementDeleted",
      ({ slideId: changeSlideId, changeId, elementId }) => {
        if (slideId !== changeSlideId) return;

        if (changeId !== ++lastChangeId) {
          reloadSlide(() => syncChange(true));
          return;
        }

        canvas.contentDocument?.getElementById(elementId)?.remove();
      },
    );

    socket.on(
      "elementModified",
      ({ slideId: changeSlideId, changeId, elementData }) => {
        if (slideId !== changeSlideId) return;

        if (changeId !== ++lastChangeId) {
          reloadSlide(() => syncChange(true));
          return;
        }

        const targetEl = canvas.contentDocument.getElementById(elementData.id);
        if (targetEl.hasAttributes()) {
          while (targetEl.attributes.length > 0) {
            targetEl.removeAttribute(targetEl.attributes[0].name);
          }
        }
        if (elementData.type === "image") {
          targetEl.setAttribute("preserveAspectRatio", "none");
        } else if (elementData.type === "text") {
          targetEl.innerHTML = escapeHtml(elementData.text) ?? "";
        }

        const { type, ...attributes } = elementData;
        for (const [key, value] of Object.entries(attributes)) {
          if (key === "text") continue;
          targetEl.setAttribute(key, value);
        }
      },
    );

    socket.on(
      "propModified",
      ({ slideId: changeSlideId, changeId, elementId, propKey, propValue }) => {
        if (slideId !== changeSlideId) return;

        if (changeId !== ++lastChangeId) {
          reloadSlide(() => syncChange(true));
          return;
        }

        const targetEl = canvas.contentDocument.getElementById(elementId);
        if (!targetEl) return;

        targetEl.setAttribute(propKey, propValue);
      },
    );

    socket.on(
      "propAppend",
      ({ slideId: changeSlideId, changeId, elementId, propKey, appendStr }) => {
        if (slideId !== changeSlideId) return;

        if (changeId !== ++lastChangeId) {
          reloadSlide(() => syncChange(true));
          return;
        }

        const targetEl = canvas.contentDocument.getElementById(elementId);
        if (!targetEl) return;

        const currentVal = targetEl.getAttribute(propKey);
        targetEl.setAttribute(propKey, currentVal + appendStr);
      },
    );

    socket.on("switchSlide", (newSlideId) => {
      goToSlide(boardId, newSlideId);
    });

    socket.on("error", ({ fatal, id, changeId }) => {
      if (changeId) {
        if (syncQueue.length > 0) {
          syncQueue.splice(0, 1);
        }
      }
      if (id === "authFailed") {
        showModal("authFailed");
        return;
      }
      reloadSlide();
      if (fatal) {
        goToSlide("", "");
        window.location.reload();
      }
    });
  });
};
