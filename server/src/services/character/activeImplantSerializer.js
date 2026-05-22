function toInt(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function normalizeActiveImplant(entry, index = 0) {
  if (!entry || typeof entry !== "object") {
    return null;
  }

  const itemID = toInt(entry.itemID || entry.implantID, 0);
  const typeID = toInt(entry.typeID || entry.implantTypeID, 0);
  const slot = toInt(entry.slot || entry.implantSlot, index + 1);
  if (typeID <= 0 || slot <= 0) {
    return null;
  }

  const normalized = {
    itemID: itemID > 0 ? itemID : slot,
    implantID: itemID > 0 ? itemID : slot,
    typeID,
    implantTypeID: typeID,
    slot,
    implantSlot: slot,
    name: String(entry.name || entry.itemName || ""),
  };

  if (entry.injectedAtMs !== undefined && entry.injectedAtMs !== null) {
    normalized.injectedAtMs = toInt(entry.injectedAtMs, 0);
  }

  return normalized;
}

function listActiveImplants(implants = []) {
  return (Array.isArray(implants) ? implants : [])
    .map(normalizeActiveImplant)
    .filter(Boolean)
    .sort((left, right) => {
      if (left.slot !== right.slot) {
        return left.slot - right.slot;
      }
      return left.typeID - right.typeID;
    });
}

function buildActiveImplantEntries(implants = [], valueBuilder) {
  const buildValue =
    typeof valueBuilder === "function"
      ? valueBuilder
      : (entry) => entry;
  return listActiveImplants(implants).map((entry) => [
    entry.itemID || entry.slot || entry.typeID,
    buildValue(entry),
  ]);
}

module.exports = {
  buildActiveImplantEntries,
  listActiveImplants,
  normalizeActiveImplant,
};
