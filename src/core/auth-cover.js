import { AUTH_COVER_IMAGE_KEY, DEFAULT_AUTH_COVER_IMAGE } from "../config/constants.js";

let authCoverTimer = null;
let authCoverIndex = 0;

function normalizeCoverImageValue(value) {
  return String(value || "").trim();
}

function normalizeCoverImages(value) {
  if (Array.isArray(value)) return value.map(normalizeCoverImageValue).filter(Boolean);
  const rawValue = normalizeCoverImageValue(value);
  if (!rawValue) return [];
  try {
    const parsed = JSON.parse(rawValue);
    if (Array.isArray(parsed)) return parsed.map(normalizeCoverImageValue).filter(Boolean);
  } catch {
    // Fall through to newline/comma parsing for legacy and textarea values.
  }
  return rawValue
    .split(/\n|,/)
    .map(normalizeCoverImageValue)
    .filter(Boolean);
}

export function loadAuthCoverImage() {
  return loadAuthCoverImages()[0] || DEFAULT_AUTH_COVER_IMAGE;
}

export function loadAuthCoverImages() {
  const images = normalizeCoverImages(localStorage.getItem(AUTH_COVER_IMAGE_KEY));
  return images.length ? images : [DEFAULT_AUTH_COVER_IMAGE];
}

function setAuthCoverImage(value) {
  const imageUrl = normalizeCoverImageValue(value) || DEFAULT_AUTH_COVER_IMAGE;
  document.documentElement.style.setProperty("--auth-cover-image", `url("${imageUrl.replace(/"/g, "%22")}")`);
  return imageUrl;
}

export function applyAuthCoverImage(value = loadAuthCoverImages()) {
  const images = normalizeCoverImages(value);
  const coverImages = images.length ? images : [DEFAULT_AUTH_COVER_IMAGE];
  window.clearInterval(authCoverTimer);
  authCoverTimer = null;
  authCoverIndex = 0;
  setAuthCoverImage(coverImages[0]);
  if (coverImages.length > 1) {
    authCoverTimer = window.setInterval(() => {
      authCoverIndex = (authCoverIndex + 1) % coverImages.length;
      setAuthCoverImage(coverImages[authCoverIndex]);
    }, 5000);
  }
  return coverImages[0];
}

export function saveAuthCoverImage(value) {
  const images = normalizeCoverImages(value);
  if (!images.length) {
    localStorage.removeItem(AUTH_COVER_IMAGE_KEY);
    return applyAuthCoverImage([DEFAULT_AUTH_COVER_IMAGE]);
  }
  localStorage.setItem(AUTH_COVER_IMAGE_KEY, JSON.stringify(images));
  return applyAuthCoverImage(images);
}

export function resetAuthCoverImage() {
  localStorage.removeItem(AUTH_COVER_IMAGE_KEY);
  return applyAuthCoverImage([DEFAULT_AUTH_COVER_IMAGE]);
}
