const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..");
const database = require(path.join(repoRoot, "server/src/newDatabase"));
const {
  applySkinToShip,
  getAppliedSkinMaterialSetID,
} = require(path.join(
  repoRoot,
  "server/src/services/ship/shipCosmeticsState",
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

const CHARACTER_ID = 982501;
const STATION_ID = 60003760;
const KOMODO_TYPE_ID = 45649;
const KOMODO_CRYPTIC_ECDYSIS_SKIN_ID = 12778;
const KOMODO_CRYPTIC_ECDYSIS_MATERIAL_SET_ID = 3637;

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function snapshotMutableTables() {
  return {
    items: cloneValue(database.read("items", "/").data || {}),
    shipCosmetics: cloneValue(database.read("shipCosmetics", "/").data || {}),
  };
}

function restoreMutableTables(snapshot) {
  database.write("items", "/", cloneValue(snapshot.items));
  database.write("shipCosmetics", "/", cloneValue(snapshot.shipCosmetics));
  database.flushAllSync();
  resetInventoryStoreForTests();
}

test("applying a valid SKIN persists ship cosmetic state and resolves material set", (t) => {
  const snapshot = snapshotMutableTables();
  t.after(() => restoreMutableTables(snapshot));
  resetInventoryStoreForTests();

  const grantResult = grantItemToOwnerLocation(
    CHARACTER_ID,
    STATION_ID,
    ITEM_FLAGS.HANGAR,
    resolveItemByTypeID(KOMODO_TYPE_ID),
    1,
    { singleton: 1 },
  );
  assert.equal(grantResult.success, true);
  const shipItem = grantResult.data.items[0];
  assert.ok(findItemById(shipItem.itemID), "expected granted ship item");

  const applyResult = applySkinToShip(
    shipItem.itemID,
    KOMODO_CRYPTIC_ECDYSIS_SKIN_ID,
  );
  assert.equal(applyResult.success, true);

  const runtimeRoot = database.read("shipCosmetics", "/").data;
  assert.equal(
    runtimeRoot.ships[String(shipItem.itemID)].skinID,
    KOMODO_CRYPTIC_ECDYSIS_SKIN_ID,
  );
  assert.equal(
    getAppliedSkinMaterialSetID(shipItem.itemID),
    KOMODO_CRYPTIC_ECDYSIS_MATERIAL_SET_ID,
  );
});
