export const generateUniqueId = (idLength = 12, isUnique = null) => {
  const charPool =
    "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

  const generateId = () => {
    let result = "";
    for (let i = 0; i < idLength; i++) {
      result += charPool.charAt(Math.floor(Math.random() * charPool.length));
    }
    return result;
  };

  const newId = generateId();
  if (!isUnique || isUnique(newId)) {
    return newId;
  }
  return generateUniqueId(idLength, isUnique);
};

export const isAlphanumeric = (text) => {
  return /^[a-zA-Z0-9]+$/i.test(text);
};

export const hasDisallowedProperties = (jsonObject, allowedProperties) => {
  return Object.keys(jsonObject).some(
    (key) => !allowedProperties.includes(key),
  );
};

export const getElementAttrs = (element) => {
  const retVal = Array.from(element.attributes).reduce((acc, attr) => {
    if (attr.name !== "class" && attr.name !== "preserveAspectRatio") {
      acc[attr.name] = attr.value;
    }
    return acc;
  }, {});
  if (element.tagName === "text") {
    retVal.text = escapeHtml(element.innerHTML) ?? "";
  }
  return retVal;
};

export const minVal = (val, min) => {
  return Math.max(parseInt(val), min);
};

export const escapeHtml = (text) => {
  return text
    ?.replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
};

export const unescapeHtml = (text) => {
  return text
    ?.replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'");
};
