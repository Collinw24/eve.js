const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..");
const database = require(path.join(repoRoot, "server/src/newDatabase"));
const spaceRuntime = require(path.join(repoRoot, "server/src/space/runtime"));
const {
  syncShipFittingStateForSession,
} = require(path.join(
  repoRoot,
  "server/src/services/character/characterState",
));
const {
  ITEM_FLAGS,
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

const CHARACTER_ID = 983501;
const STATION_ID = 60003760;
const SYSTEM_ID = 30000142;
const KOMODO_TYPE_ID = 45649;
const XL_LAUNCHER_TYPE_ID = 41182;
const HI_SLOT_0 = 27;

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
  spaceRuntime._testing.clearScenes();
}

function grantTestItem(locationID, flagID, typeID, options = {}) {
  const itemType = resolveItemByTypeID(typeID);
  assert.ok(itemType, `expected type ${typeID} to exist`);
  const result = grantItemToOwnerLocation(
    CHARACTER_ID,
    locationID,
    flagID,
    itemType,
    1,
    options,
  );
  assert.equal(result.success, true, `expected grant of ${typeID} to succeed`);
  return result.data.items[0];
}

function flattenDestinyUpdates(notifications = []) {
  const updates = [];
  for (const notification of notifications) {
    if (
      !notification ||
      notification.name !== "DoDestinyUpdate" ||
      !Array.isArray(notification.payload)
    ) {
      continue;
    }
    const payloadList = notification.payload[0];
    const items =
      payloadList &&
      payloadList.type === "list" &&
      Array.isArray(payloadList.items)
        ? payloadList.items
        : [];
    for (const entry of items) {
      const payload = Array.isArray(entry) ? entry[1] : null;
      if (Array.isArray(payload) && typeof payload[0] === "string") {
        updates.push({
          name: payload[0],
          args: Array.isArray(payload[1]) ? payload[1] : [],
        });
      }
    }
  }
  return updates;
}

function keyValEntries(value) {
  if (
    value &&
    value.type === "object" &&
    value.args &&
    value.args.type === "dict" &&
    Array.isArray(value.args.entries)
  ) {
    return value.args.entries;
  }
  if (value && value.type === "dict" && Array.isArray(value.entries)) {
    return value.entries;
  }
  return [];
}

function getKeyValValue(value, key) {
  const match = keyValEntries(value).find(([entryKey]) => String(entryKey) === String(key));
  return match ? match[1] : null;
}

function latestSlimChangeForEntity(notifications, entityID) {
  const updates = flattenDestinyUpdates(notifications);
  for (let index = updates.length - 1; index >= 0; index -= 1) {
    const update = updates[index];
    if (
      update.name === "OnSlimItemChange" &&
      Number(update.args[0]) === Number(entityID)
    ) {
      return update.args[1] || null;
    }
  }
  return null;
}

test("in-space fitting replay sends a ship slim refresh containing highslot launcher tuples", async (t) => {
  const snapshot = snapshotMutableTables();
  t.after(() => restoreMutableTables(snapshot));
  resetInventoryStoreForTests();

  const ship = grantTestItem(
    STATION_ID,
    ITEM_FLAGS.HANGAR,
    KOMODO_TYPE_ID,
    {
      singleton: 1,
      spaceState: {
        position: { x: 0, y: 0, z: 0 },
        velocity: { x: 0, y: 0, z: 0 },
        direction: { x: 1, y: 0, z: 0 },
        mode: "STOP",
        speedFraction: 0,
      },
    },
  );
  const launcher = grantTestItem(
    ship.itemID,
    HI_SLOT_0,
    XL_LAUNCHER_TYPE_ID,
    {
      singleton: 1,
      moduleState: { online: true },
    },
  );
  const session = {
    clientID: CHARACTER_ID + 1000,
    userid: CHARACTER_ID,
    characterID: CHARACTER_ID,
    charid: CHARACTER_ID,
    corporationID: 1,
    allianceID: 0,
    warFactionID: 0,
    solarsystemid: SYSTEM_ID,
    solarsystemid2: SYSTEM_ID,
    shipID: ship.itemID,
    shipid: ship.itemID,
    activeShipID: ship.itemID,
    socket: { destroyed: false },
    notifications: [],
    sendNotification(name, idType, payload) {
      this.notifications.push({ name, idType, payload });
    },
    sendSessionChange() {},
  };

  spaceRuntime.attachSession(session, {
    ...ship,
    spaceState: {
      position: { x: 0, y: 0, z: 0 },
      velocity: { x: 0, y: 0, z: 0 },
      direction: { x: 1, y: 0, z: 0 },
      mode: "STOP",
      speedFraction: 0,
    },
  }, {
    systemID: SYSTEM_ID,
    broadcast: false,
    spawnStopped: true,
  });
  assert.equal(spaceRuntime.ensureInitialBallpark(session), true);
  session.notifications.length = 0;

  const replayed = syncShipFittingStateForSession(session, ship.itemID, {
    includeOfflineModules: true,
    includeCharges: false,
  });
  assert.equal(replayed, 1);
  await new Promise((resolve) => setImmediate(resolve));

  const slim = latestSlimChangeForEntity(session.notifications, ship.itemID);
  assert.ok(slim, "expected fitting replay to emit OnSlimItemChange for the ship");
  const modules = getKeyValValue(slim, "modules");
  const moduleTuples =
    modules && modules.type === "list" && Array.isArray(modules.items)
      ? modules.items
      : [];
  assert.deepEqual(
    moduleTuples,
    [[launcher.itemID, XL_LAUNCHER_TYPE_ID, HI_SLOT_0]],
  );
});
