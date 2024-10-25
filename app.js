import dotenv from "dotenv";
import express from "express";
import http from "http";
import { Server as SocketIO } from "socket.io";
import * as fs from "node:fs";
import {
  CREATOR_ROLE,
  EDITOR_ROLE,
  GUEST_ROLE,
  NO_ROLE,
} from "./public/lib/consts.js";
import { generateUniqueId, isAlphanumeric } from "./public/lib/functions.js";
import { normalizeElement, validateSVGElement } from "./lib/slide.js";
import {
  buildBoardLocation,
  buildBoardMapLocation,
  buildImageLocation,
  buildSlideLocation,
  ensureDataDirectory,
} from "./lib/locations.js";
import { google } from "googleapis";
import {
  ensurePermissionsForSession,
  getBearerTokenFromHeaders,
  getBoardRole,
  getDefaultPermissions,
  getGoogleIdentityFromAccessToken,
  getIdentityToken,
  isPermitted,
  loadJSONFromPath,
} from "./lib/common.js";
import * as path from "node:path";
import { formidable } from "formidable";
import * as crypto from "node:crypto";
import sqlite3 from "sqlite3";

sqlite3.verbose();

dotenv.config();

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URL,
);

const app = express();
const server = http.createServer(app);
const io = new SocketIO(server);

app.use(express.static("public"));
app.use(express.json());

const database = new sqlite3.Database("app.db");
database.exec(`
CREATE TABLE IF NOT EXISTS recently_viewed (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user VARCHAR(96) NOT NULL,
    board_id VARCHAR(96) NOT NULL,
    timestamp INTEGER NOT NULL
)
`);
database.exec(`
CREATE TABLE IF NOT EXISTS board_metadata (
    board_id VARCHAR(96) PRIMARY KEY NOT NULL,
    name TEXT NOT NULL
);
`);
database.exec(`
CREATE TABLE IF NOT EXISTS image_metadata (
    image_hash VARCHAR(96) PRIMARY KEY NOT NULL,
    user VARCHAR(96) NOT NULL
);
`);

const sessions = {};

class Session {
  constructor(boardId) {
    this.boardId = boardId;
    this.members = [];
    this.slides = [];
    this.permissions = {};
    this.name = "";

    const boardMap = loadJSONFromPath(buildBoardMapLocation(boardId));
    if (boardMap) {
      this.populateSlideList(boardMap.slides);
      this.boardCreatedAt = boardMap.createdAt;
      this.permissions = boardMap.permissions;
      this.fetchBoardName();
    }
  }

  async fetchBoardName() {
    const query = `SELECT name FROM board_metadata WHERE board_id = ?`;
    const data = await dbAll(query, [this.boardId]);

    this.name = data?.[0]?.name ?? "Bez nazwy";
    this.members?.forEach((member) => {
      member.emit("boardNameUpdate", this.name);
    });
  }

  addMember(member) {
    this.members.push(member);
    this.notifyMembershipUpdate();
  }

  removeMember(member) {
    const index = this.members.indexOf(member);
    if (index > -1) {
      this.members.splice(index, 1);
      this.notifyMembershipUpdate();
    }
  }

  setPermissionMatcher(matcher, value) {
    this.permissions[matcher] = value;
    this.refreshPermissions();
  }

  removePermissionMatcher(matcher) {
    if (this.permissions.includes(matcher)) {
      delete this.permissions[matcher];
      this.refreshPermissions();
    }
  }

  refreshPermissions() {
    this.members.forEach((member) => {
      const newPerm = getBoardRole(member.identityToken, this.permissions);
      if (newPerm !== member.boardRole) {
        member.boardRole = newPerm;
        if (
          member.boardRole === GUEST_ROLE &&
          this.getSlide(member.slideId).grants.includes(member.identityToken)
        ) {
          member.emit("roleUpdated", EDITOR_ROLE);
        } else {
          member.emit("roleUpdated", newPerm);
        }
      }
    });
  }

  getSlide(slideId) {
    const slide = this.slides.find((slide) => slide.slideId === slideId);
    return slide ?? null;
  }

  removeSlide(slideId) {
    if (this.slides.some((el) => el.slideId === slideId)) {
      const slide = this.getSlide(slideId);
      slide.closeSession("slideDeleted", false, false);
      this.slides.splice(this.slides.indexOf(slide), 1);
      if (fs.existsSync(buildSlideLocation(this.boardId, slideId))) {
        fs.rmSync(buildSlideLocation(this.boardId, slideId));
      }
      this.updateMap();
    }
  }

  createSlide() {
    const newSlide = new Slide(
      this,
      generateUniqueId(
        6,
        (id) => !fs.existsSync(buildSlideLocation(this.boardId, id)),
      ),
    );
    this.slides.push(newSlide);
    this.updateMap(true);

    return newSlide;
  }

  populateSlideList(slides) {
    const map = loadJSONFromPath(buildBoardMapLocation(this.boardId));
    slides.forEach((slide) => {
      const newSlide = new Slide(this, slide);
      newSlide.grants = map?.slideGrants?.[slide] ?? [];
      this.slides.push(newSlide);
    });
  }

  changeName(newName) {
    this.name = newName;
    upsertBoardMetadata(this.boardId, this.name);
    this.members?.forEach((member) => {
      member.emit("boardNameUpdate", this.name);
    });
  }

  updateMap(slidesUpdated = true) {
    const slides = this.slides.map((e) => e.slideId);
    const slideGrants = {};
    slides.forEach((slide) => {
      slideGrants[slide] = this.getSlide(slide).grants;
    });
    fs.writeFileSync(
      buildBoardMapLocation(this.boardId),
      JSON.stringify({
        createdAt: this.boardCreatedAt,
        lastModified: Date.now(),
        permissions: this.permissions,
        slides,
        slideGrants,
      }),
    );

    if (slidesUpdated) {
      this.members?.forEach((sock) => {
        sock.emit("slidesListUpdate", slides);
      });
    }
  }

  isActive() {
    return this.members.length > 0;
  }

  notifyMembershipUpdate() {
    const memberList = this.members.map((member) => {
      return { username: member.username, role: member.boardRole };
    });
    const sanitizedMemberList = memberList.filter(
      (member) => member?.role <= EDITOR_ROLE,
    );
    this.members.forEach((member) => {
      const listByPerm =
        member.boardRole <= EDITOR_ROLE ? memberList : sanitizedMemberList;
      member.emit("updateMembersList", {
        members: listByPerm,
        userCount: memberList.length,
      });
    });
  }

  endSession() {
    this.slides.forEach((slide) => {
      slide.closeSession("sessionEnded", true);
    });

    this.members.forEach((member) => {
      member.emit("sessionEnded");
      member.close();
    });

    this.updateMap();
  }
}

class Slide {
  constructor(parent, slideId) {
    this.parent = parent;
    this.slideId = slideId;
    this.subscribers = [];
    this.diskSyncStatus = false;
    this.elements = [];
    this.grants = [];

    this.lastChangeId = 0;

    this.loadFromDisk();
  }

  isMemberEditor(socket) {
    return isPermitted(
      socket.boardRole,
      EDITOR_ROLE,
      socket.identityToken,
      this.grants,
    );
  }

  addGrant(matcher) {
    if (!this.grants.includes(matcher)) {
      this.grants.push(matcher);
      this.parent.refreshPermissions();
    }
  }

  removeGrant(matcher) {
    if (this.grants.includes(matcher)) {
      this.grants.splice(this.grants.indexOf(matcher), 1);
      this.parent.refreshPermissions();
    }
  }

  addSubscriber(session) {
    this.subscribers.push(session);
    if (session.boardRole === GUEST_ROLE) {
      session.emit(
        "roleUpdated",
        this.grants.includes(session.identityToken) ? EDITOR_ROLE : GUEST_ROLE,
      );
    }
  }

  delSubscriber(session) {
    const sessionIndex = this.subscribers[session];
    if (sessionIndex !== -1) {
      this.subscribers.splice(sessionIndex, 1);
    }
  }

  loadFromDisk() {
    const filePath = buildSlideLocation(this.parent.boardId, this.slideId);
    this.elements = [];
    if (fs.existsSync(filePath)) {
      const parsedData = loadJSONFromPath(filePath);
      this.elements = parsedData.svgData.elements ?? [];
    }
  }

  addElement(type, id, properties, member = null, notifySelf = false) {
    if (!this.isMemberEditor(member)) return false;
    const newElement = { type, id, ...properties };
    if (!validateSVGElement(newElement)) return false;
    normalizeElement(newElement);
    this.bumpChangeId();
    this.diskSyncStatus = false;
    this.elements.push(newElement);

    this.subscribers.forEach((subscriber) => {
      if (subscriber === member) {
        member.emit("syncCompleted", this.lastChangeId);
        if (!notifySelf) return;
      }
      subscriber.emit("newElement", {
        slideId: this.slideId,
        changeId: this.lastChangeId,
        elementData: newElement,
      });
    });

    return true;
  }

  deleteElement(elementId, member = null, notifySelf = false) {
    if (!this.isMemberEditor(member)) return false;
    const index = this.elements.findIndex((el) => el.id === elementId);
    if (index === -1) return false;

    this.elements.splice(index, 1);

    this.bumpChangeId();
    this.diskSyncStatus = false;

    this.subscribers.forEach((subscriber) => {
      if (subscriber === member) {
        subscriber.emit("syncCompleted", this.lastChangeId);
        if (!notifySelf) return;
      }
      subscriber.emit("elementDeleted", {
        slideId: this.slideId,
        changeId: this.lastChangeId,
        elementId: elementId,
      });
    });

    return true;
  }

  modifyElement(id, element, member = null, notifySelf = false) {
    if (!this.isMemberEditor(member)) return false;
    if (!validateSVGElement(element)) return false;
    normalizeElement(element);
    const targetEl = this.elements.find((el) => el.id === id);
    if (!targetEl) return false;
    const targetIndex = this.elements.indexOf(targetEl);
    this.bumpChangeId();
    this.diskSyncStatus = false;
    this.elements[targetIndex] = element;
    this.subscribers.forEach((subscriber) => {
      if (subscriber === member) {
        member.emit("syncCompleted", this.lastChangeId);
        if (!notifySelf) return;
      }
      subscriber.emit("elementModified", {
        slideId: this.slideId,
        changeId: this.lastChangeId,
        elementData: element,
      });
    });

    return true;
  }

  modifyElementProp(id, propKey, propValue, member = null, notifySelf = false) {
    if (!this.isMemberEditor(member)) return false;
    const targetEl = this.elements.find((el) => el.id === id);
    if (propKey === "id" || !targetEl) return false;
    const targetIndex = this.elements.indexOf(targetEl);
    const newElement = {};
    Object.assign(newElement, targetEl);
    if (propValue === undefined || propValue === null) {
      delete newElement[propKey];
    } else {
      newElement[propKey] = propValue;
    }
    if (!validateSVGElement(newElement)) return false;
    normalizeElement(newElement);
    this.bumpChangeId();
    this.diskSyncStatus = false;
    this.elements[targetIndex] = newElement;
    this.subscribers.forEach((subscriber) => {
      if (subscriber === member) {
        member.emit("syncCompleted", this.lastChangeId);
        if (!notifySelf) return;
      }
      subscriber.emit("propModified", {
        slideId: this.slideId,
        changeId: this.lastChangeId,
        elementId: id,
        propKey,
        propValue: newElement[propKey],
      });
    });
    return true;
  }

  appendToElementProp(
    id,
    propKey,
    appendString,
    member = null,
    notifySelf = false,
  ) {
    if (!this.isMemberEditor(member)) return false;

    const targetEl = this.elements.find((el) => el.id === id);
    if (!targetEl) return false;

    if (propKey === "id") return false; // Prevent modification of the 'id' property

    const targetIndex = this.elements.indexOf(targetEl);
    const newElement = { ...targetEl }; // Shallow copy of the target element
    const currentValue = newElement[propKey];

    if (typeof currentValue !== "string") return false; // Ensure the property is a string before appending

    newElement[propKey] = `${currentValue}${appendString}`; // Append the string

    if (!validateSVGElement(newElement)) return false;
    normalizeElement(newElement);

    this.bumpChangeId();
    this.diskSyncStatus = false;

    this.elements[targetIndex] = newElement;

    this.subscribers.forEach((subscriber) => {
      if (subscriber === member) {
        member.emit("syncCompleted", this.lastChangeId);
        if (!notifySelf) return;
      }
      subscriber.emit("propAppend", {
        slideId: this.slideId,
        changeId: this.lastChangeId,
        elementId: id,
        propKey,
        appendStr: appendString,
      });
    });

    return true;
  }

  bumpChangeId() {
    return ++this.lastChangeId;
  }

  syncToDisk() {
    if (!this.diskSyncStatus) {
      const exportData = { svgData: { elements: this.elements } };
      fs.writeFileSync(
        buildSlideLocation(this.parent.boardId, this.slideId),
        JSON.stringify(exportData),
      );
      this.diskSyncStatus = true;
    }
  }

  closeSession(reason = "slideDeleted", kickUser = false, syncToDisk = true) {
    if (!this.diskSyncStatus && syncToDisk) {
      this.syncToDisk();
    }

    this.subscribers.forEach((subscriber) => {
      subscriber.emit(reason, this.slideId);
      if (kickUser) {
        subscriber.disconnect();
      }
    });
  }
}

const dbAll = async (query, params = []) => {
  return new Promise((resolve, reject) => {
    database.all(query, params, (err, rows) => {
      if (err) {
        return reject(err);
      }
      resolve(rows);
    });
  });
};

io.use(async (socket, next) => {
  const token = socket.handshake.query.token;
  const name = socket.handshake.query.name ?? "unnamed";
  if (!token) {
    return next(new Error("authentication failed"));
  }
  if (name.includes("@")) {
    const userEmail = await getGoogleIdentityFromAccessToken(token);
    if (userEmail !== name || userEmail === false) {
      return next(new Error("authentication failed"));
    }
    socket.identityToken = name;
  } else {
    socket.identityToken = token;
  }
  socket.username = name;
  next();
});

io.on("connection", (socket) => {
  socket.boardId = "";
  socket.slideId = "";
  socket.watchedMember = "";
  socket.boardRole = NO_ROLE;

  console.log("connected:", socket.id);

  socket.on("startNew", () => {
    const boardId = generateUniqueId(
      36,
      (id) => !fs.existsSync(buildBoardLocation(id)),
    );
    fs.mkdirSync(buildBoardLocation(boardId));
    fs.writeFileSync(
      buildBoardMapLocation(boardId),
      JSON.stringify({
        createdAt: Date.now(),
        lastModified: Date.now(),
        slides: [],
        permissions: getDefaultPermissions(socket.identityToken),
      }),
    );
    socket.watchedMember = "";
    upsertBoardMetadata(boardId, "Bez nazwy");
    socket.emit("createdBoard", { boardId });
    setTimeout(() => {}, 2000);
  });

  socket.on("joinBoard", (boardId) => {
    if (!isAlphanumeric(boardId)) {
      socket.emit("error", { fatal: true, error: "malformed boardId" });
      socket.disconnect();
    }

    if (fs.existsSync(buildBoardLocation(boardId))) {
      if (!(boardId in sessions)) {
        sessions[boardId] = new Session(boardId);
      }
      socket.boardId = boardId;
      socket.watchedMember = "";
      socket.slideId = "";
      if (addNewSessionMember(socket, boardId) === false) return;

      const board = sessions[socket.boardId];
      socket.emit(
        "slidesListUpdate",
        board?.slides?.map((el) => el.slideId),
      );

      socket.emit("boardNameUpdate", board.name);
    } else {
      socket.emit("error", { fatal: true, error: "board not found" });
      socket.disconnect();
    }
  });

  socket.on("changeBoardName", (newName) => {
    const session = sessions[socket.boardId];
    if (!session) return;

    if (socket.boardRole === CREATOR_ROLE) {
      session.changeName(newName);
      upsertBoardMetadata(session.boardId, newName);
    }
  });

  socket.on("switchedSlide", (slideId) => {
    const session = sessions[socket.boardId];
    if (!session) return;

    if (socket.slideId) {
      const slide = session.getSlide(socket.slideId);
      slide?.delSubscriber(socket);
    }

    const slide = session.getSlide(slideId);
    if (slide) {
      socket.slideId = slideId;
      slide.addSubscriber(socket);
      session.members.forEach((member) => {
        if (member.watchedMember === socket.identityToken) {
          member.emit("switchSlide", slideId);
        }
      });
    }
  });

  socket.on("watchMember", (memberId) => {
    socket.watchedMember = memberId;
  });

  socket.on("unwatchMember", () => {
    socket.watchedMember = "";
  });

  socket.on("removeSlide", (slideId) => {
    const session = sessions[socket.boardId];
    if (!session) return;
    if (!isPermitted(socket.boardRole, EDITOR_ROLE)) return;
    session.removeSlide(slideId);
  });

  socket.on("createSlide", (data) => {
    const session = sessions[socket.boardId];
    if (!session) return;

    if (data?.onlyIfEmpty === true && session.slides.length > 0) return;

    if (!isPermitted(socket.boardRole, EDITOR_ROLE)) return;
    const slide = session.createSlide();

    socket.emit("switchSlide", slide.slideId);
  });

  socket.on("addElement", ({ changeId, element, notifySelf }) => {
    const session = sessions[socket.boardId];
    const slide = session?.getSlide(socket.slideId);
    if (!slide) return;

    if (
      !slide.addElement(element.type, element.id, element, socket, notifySelf)
    ) {
      socket.emit("error", {
        fatal: false,
        changeId,
      });
    }
  });

  socket.on("deleteElement", ({ changeId, elementId, notifySelf }) => {
    const session = sessions[socket.boardId];
    const slide = session?.getSlide(socket.slideId);
    if (!slide) return;

    if (!slide.deleteElement(elementId, socket)) {
      socket.emit("error", {
        fatal: false,
        error: "element not found",
        changeId,
        notifySelf,
      });
    }
  });

  socket.on("modifyElement", ({ changeId, element, notifySelf }) => {
    const session = sessions[socket.boardId];
    const slide = session?.getSlide(socket.slideId);
    if (!slide) return;

    if (!slide.modifyElement(element.id, element, socket, notifySelf)) {
      socket.emit("error", {
        fatal: false,
        changeId,
      });
    }
  });

  socket.on(
    "modifyElementProp",
    ({ changeId, elementId, propKey, propValue, notifySelf }) => {
      const session = sessions[socket.boardId];
      const slide = session?.getSlide(socket.slideId);
      if (!slide) return;

      if (
        !slide.modifyElementProp(
          elementId,
          propKey,
          propValue,
          socket,
          notifySelf,
        )
      ) {
        socket.emit("error", {
          fatal: false,
          error: "element not found or property invalid",
          changeId,
        });
      }
    },
  );

  socket.on(
    "appendElementProp",
    ({ changeId, elementId, propKey, appendStr, notifySelf }) => {
      const session = sessions[socket.boardId];
      const slide = session?.getSlide(socket.slideId);
      if (!slide) return;

      if (
        !slide.appendToElementProp(
          elementId,
          propKey,
          appendStr,
          socket,
          notifySelf,
        )
      ) {
        socket.emit("error", {
          fatal: false,
          error: "element not found or property invalid",
          changeId,
        });
      }
    },
  );

  socket.on("disconnect", () => {
    delSessionMember(socket);
    console.log("disconnected:", socket.id);
  });
});

const addNewSessionMember = (socket, boardId) => {
  if (!(boardId in sessions)) {
    sessions[boardId] = new Session(boardId);
  }
  const board = sessions[boardId];
  socket.boardRole = getBoardRole(socket.identityToken, board.permissions);
  if (socket.boardRole === NO_ROLE) {
    socket.emit("error", { error: "authFailed" });
    socket.disconnect();
    return false;
  }

  socket.emit("roleUpdated", socket.boardRole);
  board.addMember(socket);

  if (socket.username?.includes("@")) {
    const now = Date.now();
    let checkQuery = `
      SELECT COUNT(*) AS count FROM recently_viewed WHERE user = ? AND board_id = ?
    `;

    database.get(checkQuery, [socket.username, boardId], (err, row) => {
      if (err) return;

      if (row.count === 0) {
        let insertQuery = `
          INSERT INTO recently_viewed (user, board_id, timestamp)
          VALUES (?, ?, ?)
        `;

        database.run(insertQuery, [socket.username, boardId, now]);
      } else {
        let updateQuery = `
          UPDATE recently_viewed SET timestamp = ? WHERE user = ? AND board_id = ?
        `;

        database.run(updateQuery, [now, socket.username, boardId]);
      }
    });
  }
};

const delSessionMember = (socket) => {
  const boardId = socket.boardId;
  if (boardId && sessions[boardId]) {
    sessions[boardId].removeMember(socket);
    if (!sessions[boardId].isActive()) {
      sessions[boardId].endSession();
      delete sessions[boardId];
    }
  }
};

const upsertBoardMetadata = (boardId, name) => {
  const query = `
    INSERT INTO board_metadata (board_id, name)
    VALUES (?, ?)
    ON CONFLICT(board_id) DO UPDATE SET name = excluded.name
  `;

  database.run(query, [boardId, name]);
};

const upsertImageMetadata = (imageId, userId) => {
  const query = `
    INSERT INTO image_metadata (image_hash, user)
    VALUES (?, ?)
    ON CONFLICT(image_hash) DO UPDATE SET user = excluded.user
  `;

  database.run(query, [imageId, userId]);
};

app.get("/auth/google", (req, res) => {
  const url = oauth2Client.generateAuthUrl({
    access_type: "offline",
    scope: ["https://www.googleapis.com/auth/userinfo.email"],
  });
  res.redirect(url);
});

app.get("/auth/google/callback", async (req, res) => {
  const { code } = req.query;
  try {
    const { tokens } = await oauth2Client.getToken(code);

    const userEmail = await getGoogleIdentityFromAccessToken(
      tokens.access_token,
    );
    const htmlBody = fs
      .readFileSync("files/googleredirect.html", "utf8")
      .replace("[AT]", tokens.access_token)
      .replace("[USERNAME]", userEmail);
    res.setHeader("Content-Type", "text/html");
    res.send(htmlBody);
  } catch (error) {
    res.status(500).send(error);
  }
});

app.get("/preview/:boardId", async (req, res) => {
  const { boardId } = req.params;
  const token = getBearerTokenFromHeaders(req.headers);

  const boardMap = loadJSONFromPath(buildBoardMapLocation(boardId));
  if (!boardMap) return res.status(404).json({ error: "notFound" });
  if (boardMap?.permissions?.["*"] === NO_ROLE) {
    const realToken = await getIdentityToken(token);
    if (
      !isPermitted(getBoardRole(realToken, boardMap.permissions), GUEST_ROLE)
    ) {
      return res.status(403).json({ error: "accessDenied" });
    }
  }

  const session = sessions[boardId] ?? null;
  session?.slides?.[0]?.syncToDisk();
  const firstSlide = session?.slides[0] ?? boardMap.slides[0] ?? null;

  const slideData = loadJSONFromPath(buildSlideLocation(boardId, firstSlide));
  if (slideData) {
    res.json(slideData);
  } else {
    res.status(404).json({ error: "notFound" });
  }
});

app.get("/boards/:boardId/:slideId", async (req, res) => {
  const { boardId, slideId } = req.params;
  const token = getBearerTokenFromHeaders(req.headers);

  const slide = sessions[boardId]?.getSlide(slideId);
  slide?.syncToDisk();

  const permissions = loadJSONFromPath(
    buildBoardMapLocation(boardId),
  )?.permissions;
  if (permissions?.["*"] === NO_ROLE || permissions?.["*"] === undefined) {
    const realToken = await getIdentityToken(token);
    if (!isPermitted(getBoardRole(realToken, permissions), GUEST_ROLE)) {
      return res.status(403).json({ error: "accessDenied" });
    }
  }

  const slideData = loadJSONFromPath(buildSlideLocation(boardId, slideId));
  if (slideData) {
    slideData.changeId = slide?.lastChangeId ?? undefined;
    res.json(slideData);
  } else {
    res.status(404).json({ error: "notFound" });
  }
});

app.put("/boards/:boardId/:slideId/grants/:matcher", async (req, res) => {
  const { boardId, slideId, matcher } = req.params;
  const token = getBearerTokenFromHeaders(req.headers);

  if (
    !(await ensurePermissionsForSession(
      res,
      sessions[boardId],
      CREATOR_ROLE,
      token,
    ))
  ) {
    return;
  }
  const slide = sessions[boardId]?.getSlide(slideId);
  if (!slide) return res.status(404).json({ error: "notFound" });

  slide.addGrant(matcher);
  res.json("ok");
});

app.delete("/boards/:boardId/:slideId/grants/:matcher", async (req, res) => {
  const { boardId, slideId, matcher } = req.params;
  const token = getBearerTokenFromHeaders(req.headers);

  await ensurePermissionsForSession(
    res,
    sessions[boardId],
    CREATOR_ROLE,
    token,
  );

  const slide = sessions[boardId]?.getSlide(slideId);
  if (!slide) return res.status(404).json({ error: "notFound" });

  slide.removeGrant(matcher);
  res.json("ok");
});

app.get("/boards/:boardId/sharing/permissions", async (req, res) => {
  const { boardId } = req.params;
  const token = getBearerTokenFromHeaders(req.headers);

  const session = sessions[boardId];
  if (!session) return res.status(404).json({ error: "notFound" });

  if (!(await ensurePermissionsForSession(res, session, CREATOR_ROLE, token))) {
    return res.status(403).json({ error: "accessDenied" });
  }

  res.json({ permissions: session.permissions });
});

app.post("/boards/:boardId/sharing/permissions", async (req, res) => {
  const { boardId } = req.params;
  const token = getBearerTokenFromHeaders(req.headers);
  const { matcher, newRole } = req.body;

  if (
    !(await ensurePermissionsForSession(
      res,
      sessions[boardId],
      CREATOR_ROLE,
      token,
    ))
  ) {
    return;
  }

  const session = sessions[boardId];
  if (!session) return res.status(404).json({ error: "notFound" });

  if (newRole === -1) {
    session.removePermissionMatcher(matcher);
  } else {
    session.setPermissionMatcher(matcher, newRole);
  }

  res.json("ok");
});

app.post("/boards/:boardId/upload", async (req, res) => {
  const { boardId } = req.params;
  const token = getBearerTokenFromHeaders(req.headers);
  const identity = await getIdentityToken(token);
  if (!identity || !identity.includes("@")) {
    return res.status(403).json({ error: "noAnonymousUpload" });
  }

  const form = formidable({});

  await form.parse(req, (err, fields, files) => {
    if (!files?.image) {
      return res.status(400).send("No image file uploaded.");
    }

    const file = files.image[0];
    const buffer = fs.readFileSync(file.filepath);
    const filename = `${crypto.createHash("sha1").update(buffer).digest("hex")}.png`;
    const filePath = path.join(buildBoardLocation(boardId), filename);

    upsertImageMetadata(filename.slice(0, -4), identity);

    fs.writeFileSync(filePath, buffer);

    res.send({
      message: "File uploaded successfully",
      filePath: `/boards/${boardId}/images/${filename}`,
    });
  });
});

app.get("/boards/:boardId/images/:imageId.png", async (req, res) => {
  const { boardId, imageId } = req.params;

  if (!fs.existsSync(buildImageLocation(boardId, imageId))) {
    return res.status(404).json({ error: "notFound" });
  }

  res.sendFile(path.resolve(buildImageLocation(boardId, imageId)));
});

app.get("/boards/history", async (req, res) => {
  const identityToken = getBearerTokenFromHeaders(req.headers);
  const identity = await getIdentityToken(identityToken);
  if (!identity || !identity.includes("@")) {
    return res.status(403).json({ error: "identityTokenMustBeEmail" });
  }

  const query = `
    SELECT bm.board_id, bm.name, rv.timestamp
    FROM board_metadata bm
    JOIN recently_viewed rv ON bm.board_id = rv.board_id
    WHERE rv.user = ?
    ORDER BY rv.timestamp DESC
  `;

  database.all(query, [identity], (err, rows) => {
    if (err) {
      return res.status(500).json({ error: "internalError" });
    }
    res.json(rows);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  ensureDataDirectory();
  console.log(`Server is running on port ${PORT}`);
});
