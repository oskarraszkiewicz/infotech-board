import * as fs from "node:fs";
import {
  CREATOR_ROLE,
  EDITOR_ROLE,
  GUEST_ROLE,
  NO_ROLE,
} from "../public/lib/consts.js";

export const getBearerTokenFromHeaders = (headers) => {
  return headers.authorization?.split(" ", 2)[1];
};

export const loadJSONFromPath = (path) => {
  if (fs.existsSync(path)) {
    return JSON.parse(fs.readFileSync(path, "utf8"));
  }
};

export const getDefaultPermissions = (token) => {
  if (token.includes("@")) {
    const domain = token.split("@", 2)?.[1];
    if (domain !== "gmail.com") {
      return {
        "*": NO_ROLE,
        [token]: CREATOR_ROLE,
        [domain]: GUEST_ROLE,
      };
    }
    return {
      "*": GUEST_ROLE,
      [token]: CREATOR_ROLE,
    };
  }
  return { "*": EDITOR_ROLE, [token]: CREATOR_ROLE };
};

export const accessMatcherCheck = (token, matcher) => {
  if (matcher === "*") return true;
  if (token === matcher) return true;
  if (matcher?.includes(".") && token?.includes("@")) {
    const domainPart = token.split("@", 2)?.[1];
    if (domainPart === matcher) return true;
  }
  return false;
};

export const getBoardRole = (token, permissions) => {
  let highestPermission = NO_ROLE;
  Object.keys(permissions ?? []).forEach((matcher) => {
    if (
      highestPermission > permissions[matcher] &&
      accessMatcherCheck(token, matcher)
    ) {
      highestPermission = permissions[matcher];
    }
  });
  return highestPermission;
};

export const isPermitted = (
  globalRole,
  minRole,
  token = null,
  slideGrants = null,
) => {
  if (globalRole <= minRole) return true;
  if (minRole === EDITOR_ROLE && token && slideGrants) {
    return slideGrants.includes(token);
  }
  return false;
};

export const ensurePermissionsForSession = async (
  res,
  session,
  minRole,
  token,
) => {
  const permissions = session?.permissions;
  const realToken = await getIdentityToken(token ?? "");
  if (!isPermitted(getBoardRole(realToken, permissions), CREATOR_ROLE)) {
    res.status(403).json({ error: "accessDenied" });
    return false;
  }
  return true;
};

const googleIdentityCache = {};

export const getIdentityToken = async (providedToken) => {
  if (providedToken?.includes("@")) {
    return;
  }
  if (providedToken.startsWith("google-")) {
    const realToken = providedToken.slice(providedToken.indexOf("-") + 1);
    return await getGoogleIdentityFromAccessToken(realToken);
  }
  return providedToken;
};

export const getGoogleIdentityFromAccessToken = async (accessToken) => {
  if (accessToken in googleIdentityCache) {
    return googleIdentityCache[accessToken];
  }

  const response = await fetch(
    `https://www.googleapis.com/oauth2/v1/userinfo?access_token=${accessToken}`,
  );

  const parsedData = await response.json();
  if (parsedData?.email !== undefined) {
    googleIdentityCache[accessToken] = parsedData.email;
    return parsedData.email;
  }
  return false;
};
