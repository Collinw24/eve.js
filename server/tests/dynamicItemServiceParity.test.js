const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..");
const database = require(path.join(repoRoot, "server/src/newDatabase"));
const DynamicItemService = require(path.join(
  repoRoot,
  "server/src/services/dogma/dynamicItemService",
));
const {
  ITEM_FLAGS,
  findItemById,
  grantItemToOwnerLocation,
  resetInventoryStoreForTests,
} = require(path.join(
  repoRoot,
  "server/src/services/inventory/itemStore",
));
const {
  resolveItemByTypeID,
} = require(path.join(
  repoRoot,
  "server/src/services/inventory/itemTypeRegistry",
));
const {
  buildEffectiveItemAttributeMap,
} = require(path.join(
  repoRoot,
  "server/src/services/fitting/liveFittingState",
));

const CHARACTER_ID = 981501;
const STATION_ID = 60003760;
const UNSTABLE_LARGE_EMP_SMARTBOMB_MUTAPLASMID = 84422;
const VIZANS_MODIFIED_LARGE_EMP_SMARTBOMB = 14792;
const ABYSSAL_LARGE_EMP_SMARTBOMB = 84434;

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function snapshotMutableTables() {
  return {
    items: cloneValue(database.read("items", "/").data || {}),
  };
}

function restoreMutableTables(snapshot) {
  database.write("items", "/", cloneValue(snapshot.items));
  database.flushAllSync();
  resetInventoryStoreForTests();
}

function grantTestItem(typeID, quantity = 1, options = {}) {
  const itemType = resolveItemByTypeID(typeID);
  assert.ok(itemType, `expected type ${typeID} to exist`);
  const result = grantItemToOwnerLocation(
    CHARACTER_ID,
    STATION_ID,
    ITEM_FLAGS.HANGAR,
    itemType,
    quantity,
    options,
  );
  assert.equal(result.success, true, `expected grant of ${typeID} to succeed`);
  assert.ok(result.data.items.length > 0, "expected granted item row");
  return result.data.items[0];
}

function getKeyValEntry(payload, key) {
  const entries =
    payload &&
    payload.args &&
    payload.args.type === "dict" &&
    Array.isArray(payload.args.entries)
      ? payload.args.entries
      : [];
  const match = entries.find(([entryKey]) => String(entryKey) === String(key));
  return match ? match[1] : null;
}

test("dynamicItemService applies a mutaplasmid, consumes one stack unit, and exposes rolled attributes", (t) => {
  const snapshot = snapshotMutableTables();
  t.after(() => restoreMutableTables(snapshot));
  resetInventoryStoreForTests();

  const mutaplasmid = grantTestItem(
    UNSTABLE_LARGE_EMP_SMARTBOMB_MUTAPLASMID,
    2,
    { singleton: 0 },
  );
  const target = grantTestItem(
    VIZANS_MODIFIED_LARGE_EMP_SMARTBOMB,
    1,
    { singleton: 1 },
  );
  const session = {
    characterID: CHARACTER_ID,
    notifications: [],
    sendNotification(name, idType, payload) {
      this.notifications.push({ name, idType, payload });
    },
  };

  const service = new DynamicItemService();
  const response = service.Handle_CreateDynamicItem(
    [mutaplasmid.itemID, target.itemID],
    session,
  );

  assert.equal(getKeyValEntry(response, "itemID"), target.itemID);
  assert.equal(getKeyValEntry(response, "typeID"), ABYSSAL_LARGE_EMP_SMARTBOMB);

  const updatedTarget = findItemById(target.itemID);
  assert.ok(updatedTarget, "expected target item to remain");
  assert.equal(updatedTarget.typeID, ABYSSAL_LARGE_EMP_SMARTBOMB);
  assert.equal(updatedTarget.singleton, 1);
  assert.equal(updatedTarget.dynamicItem.sourceTypeID, VIZANS_MODIFIED_LARGE_EMP_SMARTBOMB);
  assert.equal(
    updatedTarget.dynamicItem.mutaplasmidTypeID,
    UNSTABLE_LARGE_EMP_SMARTBOMB_MUTAPLASMID,
  );
  assert.ok(
    Object.keys(updatedTarget.dynamicAttributes || {}).length > 0,
    "expected rolled dynamic attributes",
  );

  const remainingMutaplasmid = findItemById(mutaplasmid.itemID);
  assert.ok(remainingMutaplasmid, "expected one mutaplasmid to remain in stack");
  assert.equal(Number(remainingMutaplasmid.stacksize), 1);

  const effectiveAttributes = buildEffectiveItemAttributeMap(updatedTarget);
  for (const [attributeID, value] of Object.entries(updatedTarget.dynamicAttributes)) {
    assert.equal(
      Number(effectiveAttributes[Number(attributeID)]),
      Number(value),
      `expected dynamic override for attribute ${attributeID}`,
    );
  }

  const info = service.Handle_GetDynamicItemInfo([target.itemID], session);
  assert.equal(getKeyValEntry(info, "itemID"), target.itemID);
  assert.equal(getKeyValEntry(info, "resultingTypeID"), ABYSSAL_LARGE_EMP_SMARTBOMB);
});
