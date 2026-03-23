export function parseLabelParts(rawLabel) {
  const label = String(rawLabel || "").trim();
  if (!label) {
    return { base: "", tags: [] };
  }

  const tags = [];
  const tagPattern = /\(([^()]+)\)/g;
  let match = null;
  while ((match = tagPattern.exec(label)) !== null) {
    const tag = String(match[1] || "").trim();
    if (tag) tags.push(tag);
  }

  const base = label.replace(/\s*\([^()]+\)/g, " ").replace(/\s+/g, " ").trim();
  return { base: base || label, tags };
}

export function tagVariant(rawTag, { includeState = true } = {}) {
  const text = String(rawTag || "").toLowerCase();
  if (!text) return "neutral";
  if (text.includes("mix")) return "mix";
  if (
    includeState
    && (text.includes("unavailable") || text.includes("disconnected") || text.includes("connecting"))
  ) {
    return "state";
  }
  if (
    text.includes("toggle")
    || text.includes("mute")
    || text.includes("media")
    || text.includes("stop")
    || text.includes("play")
    || text.includes("next")
    || text.includes("prev")
    || text.includes("record")
    || text.includes("stream")
    || text.includes("visibility")
    || text.includes("trigger")
    || text.includes("action")
  ) {
    return "action";
  }
  return "neutral";
}
