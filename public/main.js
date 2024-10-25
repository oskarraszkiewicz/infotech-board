import { authenticate, connectToSocket } from "./lib/collaboration.js";
import { initUI } from "./lib/ui.js";
import { displayRecents } from "./lib/recents.js";

authenticate(() => {
  const path = window.location.pathname;
  if (path.includes("drawing.html")) {
    initUI();
    connectToSocket({
      token: localStorage.getItem("token"),
      name: localStorage.getItem("name"),
    });
  } else if (path === "/" || path.includes("index.html")) {
    displayRecents();
  }
}, false);
