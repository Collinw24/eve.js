const fs = require("fs");
const path = require("path");

const BaseService = require(path.join(__dirname, "../baseService"));
const log = require(path.join(__dirname, "../../utils/logger"));
const database = require(path.join(__dirname, "../../newDatabase"));
const {
  throwWrappedUserError,
} = require(path.join(__dirname, "../../common/machoErrors"));
const {
  consumeInventoryItemQuantity,
  findItemById,
  updateInventoryItem,
} = require(path.join(__dirname, "../inventory/itemStore"));
const {
  resolveItemByTypeID,
} = require(path.join(__dirname, "../inventory/itemTypeRegistry"));
const {
  buildDict,
  buildKeyVal,
} = require(path.join(__dirname, "../_shared/serviceHelpers"));
const {
  buildEffectiveItemAttributeMap,
} = require(path.join(__dirname, "../fitting/liveFittingState"));
const {
  syncInventoryItemForSession,
} = require(path.join(__dirname, "../character/characterState"));

const DYNAMIC_ITEM_TABLE = "dynamicItemAttributes";
let cachedDynamicDefinitions = null;

function toInt(value, fallback = 0) {
  if (Buffer.isBuffer(value)) {
    return toInt(value.toString("utf8"), fallback);
  }
  if (value && typeof value === "object") {
    if (Object.prototype.hasOwnProperty.call(value, "value")) {
      return toInt(value.value, fallback);
    }
    if (value.type === "int" || value.type === "long") {
      return toInt(value.value, fallback);
    }
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function toFiniteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function unwrapValue(value) {
  if (Buffer.isBuffer(value)) {
    return value.toString("utf8");
  }
  if (value && typeof value === "object") {
    if (Object.prototype.hasOwnProperty.call(value, "value")) {
      return unwrapValue(value.value);
    }
    if (value.type === "list" && Array.isArray(value.items)) {
      return value.items.map((item) => unwrapValue(item));
    }
  }
  return value;
}

function throwDynamicItemError(message) {
  throwWrappedUserError("CustomNotify", {
    notify: message,
  });
}

function normalizeDefinition(rawDefinition) {
  if (!rawDefinition || typeof rawDefinition !== "object") {
    return null;
  }
  const mutaplasmidTypeID = toInt(rawDefinition._key || rawDefinition.typeID, 0);
  if (mutaplasmidTypeID <= 0) {
    return null;
  }

  const attributes = (Array.isArray(rawDefinition.attributeIDs)
    ? rawDefinition.attributeIDs
    : [])
    .map((entry) => ({
      attributeID: toInt(entry && (entry._key || entry.attributeID), 0),
      min: toFiniteNumber(entry && entry.min, 1),
      max: toFiniteNumber(entry && entry.max, 1),
    }))
    .filter((entry) => entry.attributeID > 0);
  const mappings = (Array.isArray(rawDefinition.inputOutputMapping)
    ? rawDefinition.inputOutputMapping
    : [])
    .map((entry) => ({
      applicableTypes: (Array.isArray(entry && entry.applicableTypes)
        ? entry.applicableTypes
        : [])
        .map((typeID) => toInt(typeID, 0))
        .filter((typeID) => typeID > 0),
      resultingType: toInt(entry && entry.resultingType, 0),
    }))
    .filter((entry) => entry.resultingType > 0 && entry.applicableTypes.length > 0);

  if (attributes.length === 0 || mappings.length === 0) {
    return null;
  }

  return {
    mutaplasmidTypeID,
    attributes,
    mappings,
  };
}

function loadDefinitionsFromDatabase() {
  const result = database.read(DYNAMIC_ITEM_TABLE, "/");
  if (!result.success || !result.data || typeof result.data !== "object") {
    return [];
  }
  const root = result.data;
  if (Array.isArray(root.entries)) {
    return root.entries;
  }
  if (Array.isArray(root.definitions)) {
    return root.definitions;
  }
  if (root.definitionsByTypeID && typeof root.definitionsByTypeID === "object") {
    return Object.values(root.definitionsByTypeID);
  }
  if (root.typesByTypeID && typeof root.typesByTypeID === "object") {
    return Object.values(root.typesByTypeID);
  }
  return Object.values(root);
}

function loadDefinitionsFromSourceJson() {
  const sourcePath = path.join(
    __dirname,
    "../../../../tools/DataSync/source_json/dynamicItemAttributes.jsonl",
  );
  if (!fs.existsSync(sourcePath)) {
    return [];
  }

  return fs.readFileSync(sourcePath, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        return null;
      }
    })
    .filter(Boolean);
}

function getDynamicDefinitions() {
  if (cachedDynamicDefinitions) {
    return cachedDynamicDefinitions;
  }

  const definitions = [
    ...loadDefinitionsFromDatabase(),
    ...loadDefinitionsFromSourceJson(),
  ]
    .map(normalizeDefinition)
    .filter(Boolean);
  const byMutaplasmidTypeID = new Map();
  for (const definition of definitions) {
    byMutaplasmidTypeID.set(definition.mutaplasmidTypeID, definition);
  }
  cachedDynamicDefinitions = byMutaplasmidTypeID;
  return cachedDynamicDefinitions;
}

function resolveDynamicDefinition(mutaplasmidTypeID) {
  return getDynamicDefinitions().get(toInt(mutaplasmidTypeID, 0)) || null;
}

function resolveMapping(definition, sourceTypeID) {
  const numericSourceTypeID = toInt(sourceTypeID, 0);
  if (!definition || numericSourceTypeID <= 0) {
    return null;
  }
  return definition.mappings.find((mapping) =>
    mapping.applicableTypes.includes(numericSourceTypeID),
  ) || null;
}

function rollDynamicAttributes(definition, targetItem) {
  const baseAttributes = buildEffectiveItemAttributeMap(targetItem);
  const dynamicAttributes = {};
  const rolls = {};

  for (const attribute of definition.attributes) {
    const baseValue = toFiniteNumber(baseAttributes[attribute.attributeID], NaN);
    if (!Number.isFinite(baseValue)) {
      continue;
    }
    const min = Math.min(attribute.min, attribute.max);
    const max = Math.max(attribute.min, attribute.max);
    const multiplier = min + Math.random() * (max - min);
    const value = baseValue * multiplier;
    dynamicAttributes[String(attribute.attributeID)] = value;
    rolls[String(attribute.attributeID)] = {
      baseValue,
      min,
      max,
      multiplier,
      value,
    };
  }

  return {
    dynamicAttributes,
    rolls,
  };
}

function getSessionCharacterID(session) {
  return toInt(
    session &&
      (session.characterID || session.charID || session.charid || session.userid),
    0,
  );
}

function itemStackQuantity(item) {
  if (!item) {
    return 0;
  }
  if (toInt(item.singleton, 0) > 0) {
    return 1;
  }
  return Math.max(0, toInt(item.stacksize ?? item.quantity, 0));
}

function syncInventoryChangesToSession(session, changes = []) {
  if (!session || typeof syncInventoryItemForSession !== "function") {
    return;
  }
  for (const change of Array.isArray(changes) ? changes : []) {
    if (!change || !change.item) {
      continue;
    }
    syncInventoryItemForSession(
      session,
      change.item,
      change.previousData || {},
      {
        emitCfgLocation: false,
      },
    );
  }
}

function refreshFittedTargetPresentation(session, item) {
  if (!session || !session._space || !item) {
    return false;
  }
  const shipID = toInt(session._space.shipID || session.shipID || session.shipid, 0);
  if (shipID <= 0 || toInt(item.locationID, 0) !== shipID) {
    return false;
  }

  try {
    const runtime = require(path.join(__dirname, "../../space/runtime"));
    const scene =
      runtime && typeof runtime.getSceneForSession === "function"
        ? runtime.getSceneForSession(session)
        : null;
    const shipEntity =
      scene && typeof scene.getEntityByID === "function"
        ? scene.getEntityByID(shipID)
        : null;
    if (!scene || !shipEntity || shipEntity.kind !== "ship") {
      return false;
    }
    const sessionCharacterID = getSessionCharacterID(session);
    if (sessionCharacterID > 0) {
      shipEntity.characterID = sessionCharacterID;
      shipEntity.pilotCharacterID = sessionCharacterID;
    }
    if (typeof scene.sendSlimItemChangesToSession === "function") {
      scene.sendSlimItemChangesToSession(session, [shipEntity]);
    }
    if (typeof scene.broadcastSlimItemChanges === "function") {
      scene.broadcastSlimItemChanges([shipEntity], session);
    }
    return true;
  } catch (error) {
    log.warn(
      `[DynamicItemService] Failed to refresh fitted dynamic item presentation itemID=${item.itemID}: ${error.message}`,
    );
    return false;
  }
}

function buildDynamicItemInfo(item) {
  if (!item || !item.dynamicItem) {
    return null;
  }
  const dynamicAttributes =
    item.dynamicAttributes && typeof item.dynamicAttributes === "object"
      ? item.dynamicAttributes
      : {};
  const rolls =
    item.dynamicItem.rolls && typeof item.dynamicItem.rolls === "object"
      ? item.dynamicItem.rolls
      : {};

  return buildKeyVal([
    ["itemID", toInt(item.itemID, 0)],
    ["typeID", toInt(item.typeID, 0)],
    ["mutaplasmidTypeID", toInt(item.dynamicItem.mutaplasmidTypeID, 0)],
    ["sourceTypeID", toInt(item.dynamicItem.sourceTypeID, 0)],
    ["resultingTypeID", toInt(item.dynamicItem.resultingTypeID, toInt(item.typeID, 0))],
    ["createdAtMs", toInt(item.dynamicItem.createdAtMs, 0)],
    [
      "attributes",
      buildDict(
        Object.entries(dynamicAttributes).map(([attributeID, value]) => [
          toInt(attributeID, 0),
          buildKeyVal([
            ["attributeID", toInt(attributeID, 0)],
            ["value", toFiniteNumber(value, 0)],
            ["baseValue", toFiniteNumber(rolls[attributeID] && rolls[attributeID].baseValue, 0)],
            ["min", toFiniteNumber(rolls[attributeID] && rolls[attributeID].min, 1)],
            ["max", toFiniteNumber(rolls[attributeID] && rolls[attributeID].max, 1)],
            [
              "multiplier",
              toFiniteNumber(rolls[attributeID] && rolls[attributeID].multiplier, 1),
            ],
          ]),
        ]),
      ),
    ],
  ]);
}

class DynamicItemService extends BaseService {
  constructor() {
    super("dynamicItemService");
  }

  Handle_CreateDynamicItem(args, session) {
    const mutaplasmidItemID = toInt(unwrapValue(args && args[0]), 0);
    const targetItemID = toInt(unwrapValue(args && args[1]), 0);
    const characterID = getSessionCharacterID(session);

    const mutaplasmidItem = findItemById(mutaplasmidItemID);
    const targetItem = findItemById(targetItemID);
    if (!mutaplasmidItem || !targetItem) {
      throwDynamicItemError("The mutaplasmid or target item could not be found.");
    }
    if (
      characterID > 0 &&
      (
        toInt(mutaplasmidItem.ownerID, 0) !== characterID ||
        toInt(targetItem.ownerID, 0) !== characterID
      )
    ) {
      throwDynamicItemError("You can only mutate items you own.");
    }
    if (itemStackQuantity(mutaplasmidItem) <= 0) {
      throwDynamicItemError("That mutaplasmid stack is empty.");
    }

    const definition = resolveDynamicDefinition(mutaplasmidItem.typeID);
    if (!definition) {
      throwDynamicItemError("That item is not a supported mutaplasmid.");
    }
    const mapping = resolveMapping(definition, targetItem.typeID);
    if (!mapping) {
      throwDynamicItemError("That mutaplasmid cannot be applied to the selected item.");
    }

    const rollResult = rollDynamicAttributes(definition, targetItem);
    if (Object.keys(rollResult.dynamicAttributes).length === 0) {
      throwDynamicItemError("The selected item has no mutable attributes for this mutaplasmid.");
    }

    const resultingType = resolveItemByTypeID(mapping.resultingType) || {};
    const updateResult = updateInventoryItem(targetItem.itemID, (current) => ({
      ...current,
      typeID: mapping.resultingType,
      itemName: resultingType.name || current.itemName,
      singleton: 1,
      quantity: null,
      stacksize: 1,
      dynamicAttributes: rollResult.dynamicAttributes,
      dynamicItem: {
        mutaplasmidTypeID: toInt(mutaplasmidItem.typeID, 0),
        sourceTypeID: toInt(targetItem.typeID, 0),
        resultingTypeID: mapping.resultingType,
        createdAtMs: Date.now(),
        rolls: rollResult.rolls,
      },
    }));
    if (!updateResult.success) {
      throwDynamicItemError("Failed to update the target item.");
    }

    const consumeResult = consumeInventoryItemQuantity(mutaplasmidItem.itemID, 1, {
      removeContents: false,
    });
    if (!consumeResult.success) {
      updateInventoryItem(targetItem.itemID, updateResult.previousData);
      throwDynamicItemError("Failed to consume the mutaplasmid.");
    }

    const changes = [
      {
        removed: false,
        previousData: updateResult.previousData,
        item: updateResult.data,
      },
      ...((consumeResult.data && consumeResult.data.changes) || []),
    ];
    syncInventoryChangesToSession(session, changes);
    refreshFittedTargetPresentation(session, updateResult.data);

    log.info(
      `[DynamicItemService] CreateDynamicItem(mutaplasmidItemID=${mutaplasmidItemID}, targetItemID=${targetItemID}) -> itemID=${targetItemID} typeID=${mapping.resultingType}`,
    );
    return buildDynamicItemInfo(updateResult.data);
  }

  Handle_GetDynamicItemInfo(args) {
    const itemID = toInt(unwrapValue(args && args[0]), 0);
    const item = findItemById(itemID);
    const info = buildDynamicItemInfo(item);
    log.debug(
      `[DynamicItemService] GetDynamicItemInfo(itemID=${itemID}) -> ${info ? "hit" : "miss"}`,
    );
    return info;
  }
}

module.exports = DynamicItemService;
module.exports._testing = {
  buildDynamicItemInfo,
  getDynamicDefinitions,
  resolveDynamicDefinition,
  resolveMapping,
  rollDynamicAttributes,
};
