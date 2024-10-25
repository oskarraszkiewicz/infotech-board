import { getTokenForHttpRequests, logoutSession } from "./collaboration.js";
import { loadSVGFromJSON } from "./drawing.js";
import { showModal } from "./ui.js";

export const displayRecents = async () => {
  Array.from(document.querySelectorAll(".addNewBoard")).forEach((el) => {
    el.addEventListener("click", () => {
      window.location.href = "drawing.html";
    });
  });

  Array.from(document.querySelectorAll(".logoutBtn")).forEach((el) => {
    el.addEventListener("click", () => {
      logoutSession();
    });
  });

  const response = await fetch(`/boards/history`, {
    headers: {
      Authorization: `Bearer ${getTokenForHttpRequests()}`,
    },
  });
  if (response.status === 403) {
    if (localStorage.getItem("name")?.includes("@")) {
      logoutSession();
    } else {
      showModal("anonNotAllowed");
    }
    return;
  }
  const data = await response.json();
  const list = document.getElementById("latestBoards");
  data.forEach((el) => {
    const newItem = document.createElement("a");
    newItem.href = `drawing.html#${el.board_id}`;
    newItem.innerHTML = `<div class="recentBoard">
        <object id="svg_${el.board_id}"></object>
        <div class="recentMeta">
            <p>${el.name.substring(0, 40)}</p>
        </div>
    </div>`;

    list.appendChild(newItem);

    fetch(`/preview/${el.board_id}`, {
      headers: {
        Authorization: `Bearer ${getTokenForHttpRequests()}`,
      },
    }).then(async (resp) => {
      const objectData = await resp.json();
      const tgtCanvas = document.getElementById(`svg_${el.board_id}`);
      loadSVGFromJSON(objectData, null, tgtCanvas);
    });
  });
};
