import logger from "../logger.js";
import { getCharacterData } from "./import.js";
import { isEqual } from "../../vendor/lowdash/isequal.js";
import { getCampaignId, getCompendiumType } from "../muncher/utils.js";
import { looseItemNameMatch } from "../muncher/import.js";
import DICTIONARY from "../dictionary.js";
import { getCobalt, checkCobalt } from "../lib/Secrets.js";


var itemIndex;

function activeUpdate() {
  const dynamicSync = game.settings.get("ddb-importer", "dynamic-sync");
  const updateUser = game.settings.get("ddb-importer", "dynamic-sync-user");
  const gmSyncUser = game.user.isGM && game.user.id == updateUser;
  // console.warn(`Dynamic sync: ${dynamicSync}`);
  // console.warn(`Dynamic sync user: ${updateUser}`);
  // console.warn(`gmSyncUser: ${gmSyncUser}`);
  return dynamicSync && gmSyncUser;
}

export async function getUpdateItemIndex() {
  if (itemIndex) return itemIndex;
  const compendium = await getCompendiumType("item", false);

  const indexFields = [
    "name",
    "type",
    "flags.ddbimporter.definitionId",
    "flags.ddbimporter.definitionEntityTypeId",
  ];
  // eslint-disable-next-line require-atomic-updates
  itemIndex = await compendium.getIndex({ fields: indexFields });

  return itemIndex;
}

async function getCompendiumItemInfo(item) {
  const index = await getUpdateItemIndex();
  const match = await looseItemNameMatch(item, index, true, false, true);
  return match;
}

async function updateCharacterCall(actor, path, bodyContent) {
  const characterId = actor.data.flags.ddbimporter.dndbeyond.characterId;
  const cobaltCookie = getCobalt(actor.id);
  const dynamicSync = activeUpdate();
  const parsingApi = dynamicSync
    ? game.settings.get("ddb-importer", "dynamic-api-endpoint")
    : game.settings.get("ddb-importer", "api-endpoint");
  const betaKey = game.settings.get("ddb-importer", "beta-key");
  const campaignId = getCampaignId();
  const proxyCampaignId = campaignId === "" ? null : campaignId;
  const coreBody = {
    cobalt: cobaltCookie,
    betaKey,
    characterId,
    campaignId: proxyCampaignId,
    dynamicSync,
  };
  const body = { ...coreBody, ...bodyContent };

  const url = dynamicSync
    ? `${parsingApi}/dynamic/update/${path}`
    : `${parsingApi}/proxy/update/${path}`;

  logger.debug("Update body:", bodyContent);

  return new Promise((resolve, reject) => {
    fetch(url, {
      method: "POST",
      cache: "no-cache",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body), // body data type must match "Content-Type" header
    })
      .then((response) => response.json())
      .then((data) => {
        if (!data.success) {
          logger.warn("Update failed:", data.message);
          resolve(data);
        }
        logger.debug(`${path} updated`);
        return data;
      })
      .then((data) => resolve(data))
      .catch((error) => {
        logger.error(`Setting ${path} failed`);
        logger.error(error);
        logger.error(error.stack);
        reject(error);
      });
  });
}

async function spellSlotsPact(actor, ddbData) {
  return new Promise((resolve) => {
    if (!game.settings.get("ddb-importer", "sync-policy-spells-slots")) resolve();
    if (
      actor.data.data.spells.pact.max > 0 &&
      ddbData.character.character.data.spells.pact.value !== actor.data.data.spells.pact.value
    ) {
      const used = actor.data.data.spells.pact.max - actor.data.data.spells.pact.value;
      let spellSlotPackData = {
        spellslots: {},
        pact: true,
      };
      spellSlotPackData.spellslots[`level${actor.data.data.spells.pact.level}`] = used;
      const spellPactSlots = updateCharacterCall(actor, "spell/slots", spellSlotPackData);
      resolve(spellPactSlots);
    }
    resolve();
  });
}

async function spellSlots(actor, ddbData) {
  return new Promise((resolve) => {
    if (!game.settings.get("ddb-importer", "sync-policy-spells-slots")) resolve();

    let spellSlotData = { spellslots: {}, update: false };
    for (let i = 1; i <= 9; i++) {
      let spellData = actor.data.data.spells[`spell${i}`];
      if (spellData.max > 0 && ddbData.character.character.data.spells[`spell${i}`].value !== spellData.value) {
        const used = spellData.max - spellData.value;
        spellSlotData.spellslots[`level${i}`] = used;
        spellSlotData["update"] = true;
      }
    }
    if (spellSlotData["update"]) {
      resolve(updateCharacterCall(actor, "spells/slots", spellSlotData));
    }

    resolve();
  });
}

async function currency(actor, ddbData) {
  return new Promise((resolve) => {
    if (!game.settings.get("ddb-importer", "sync-policy-currency")) resolve();

    const value = {
      pp: Number.isInteger(actor.data.data.currency.pp) ? actor.data.data.currency.pp : 0,
      gp: Number.isInteger(actor.data.data.currency.gp) ? actor.data.data.currency.gp : 0,
      ep: Number.isInteger(actor.data.data.currency.ep) ? actor.data.data.currency.ep : 0,
      sp: Number.isInteger(actor.data.data.currency.sp) ? actor.data.data.currency.sp : 0,
      cp: Number.isInteger(actor.data.data.currency.cp) ? actor.data.data.currency.cp : 0,
    };

    const same = isEqual(ddbData.character.character.data.currency, value);

    if (!same) {
      resolve(updateCharacterCall(actor, "currency", value));
    }

    resolve();
  });
}

async function xp(actor, ddbData) {
  return new Promise((resolve) => {
    if (!game.settings.get("ddb-importer", "sync-policy-xp")) resolve();
    const same = ddbData.character.character.data.details.xp.value === actor.data.data.details.xp.value;

    if (!same) {
      resolve(updateCharacterCall(actor, "xp", { currentXp: actor.data.data.details.xp.value }));
    }

    resolve();
  });
}

async function updateDDBHitPoints(actor) {
  return new Promise((resolve) => {
    const temporaryHitPoints = actor.data.data.attributes.hp.temp ? actor.data.data.attributes.hp.temp : 0;
    const removedHitPoints = actor.data.data.attributes.hp.max - actor.data.data.attributes.hp.value;
    const hitPointData = {
      removedHitPoints,
      temporaryHitPoints,
    };
    resolve(updateCharacterCall(actor, "hitpoints", hitPointData));
  });
}

async function hitPoints(actor, ddbData) {
  return new Promise((resolve) => {
    if (!game.settings.get("ddb-importer", "sync-policy-hitpoints")) resolve();
    const temporaryHitPoints = actor.data.data.attributes.hp.temp ? actor.data.data.attributes.hp.temp : 0;
    const same =
      ddbData.character.character.data.attributes.hp.value === actor.data.data.attributes.hp.value &&
      ddbData.character.character.data.attributes.hp.temp === temporaryHitPoints;

    if (!same) {
      resolve(updateDDBHitPoints(actor));
    }

    resolve();
  });
}

async function inspiration(actor, ddbData) {
  return new Promise((resolve) => {
    if (!game.settings.get("ddb-importer", "sync-policy-inspiration")) resolve();
    const same = ddbData.character.character.data.attributes.inspiration === actor.data.data.attributes.inspiration;

    if (!same) {
      const inspiration = updateCharacterCall(actor, "inspiration", {
        inspiration: actor.data.data.attributes.inspiration,
      });
      resolve(inspiration);
    }

    resolve();
  });
}

async function exhaustion(actor, ddbData) {
  return new Promise((resolve) => {
    if (!game.settings.get("ddb-importer", "sync-policy-condition")) resolve();
    const same = ddbData.character.character.data.attributes.exhaustion === actor.data.data.attributes.exhaustion;

    if (!same) {
      let exhaustionData = {
        conditionId: 4,
        addCondition: false,
      };
      if (actor.data.data.attributes.exhaustion !== 0) {
        exhaustionData["level"] = actor.data.data.attributes.exhaustion;
        exhaustionData["totalHP"] = actor.data.data.attributes.hp.max;
        exhaustionData["addCondition"] = true;
      }
      resolve(updateCharacterCall(actor, "condition", exhaustionData));
    }

    resolve();
  });
}

async function deathSaves(actor, ddbData) {
  return new Promise((resolve) => {
    if (!game.settings.get("ddb-importer", "sync-policy-deathsaves")) resolve();
    const same = isEqual(ddbData.character.character.data.attributes.death, actor.data.data.attributes.death);

    if (!same) {
      const deathSaveData = {
        failCount: actor.data.data.attributes.death.failure,
        successCount: actor.data.data.attributes.death.success,
      };
      resolve(updateCharacterCall(actor, "deathsaves", deathSaveData));
    }

    resolve();
  });
}

async function hitDice(actor, ddbData) {
  return new Promise((resolve) => {
    if (!game.settings.get("ddb-importer", "sync-policy-hitdice")) resolve();

    const ddbClasses = ddbData.character.classes;

    const klasses = actor.data.items.filter(
      (item) => item.type === "class" && item.data.flags.ddbimporter.id && item.data.flags.ddbimporter.definitionId
    );

    let hitDiceData = {
      classHitDiceUsed: {},
      resetMaxHpModifier: false,
    };

    klasses.forEach((klass) => {
      const classMatch = ddbClasses.find((ddbClass) => ddbClass.flags.ddbimporter.id === klass.data.flags.ddbimporter.id);
      if (classMatch && classMatch.data.hitDiceUsed !== klass.data.data.hitDiceUsed) {
        hitDiceData.classHitDiceUsed[klass.data.flags.ddbimporter.id] = klass.data.data.hitDiceUsed;
      }
    });

    const same = isEqual({}, hitDiceData.classHitDiceUsed);
    if (!same) {
      resolve(updateCharacterCall(actor, "hitdice", { shortRest: hitDiceData }));
    }

    resolve();
  });
}

async function updateSpellsPrepared(actor, spellPreparedData) {
  return new Promise((resolve) => {
    resolve(updateCharacterCall(actor, "spell/prepare", spellPreparedData));
  });
}

async function spellsPrepared(actor, ddbData) {
  if (!game.settings.get("ddb-importer", "sync-policy-spells-prepared")) return [];
  const ddbSpells = ddbData.character.spells;

  const preparedSpells = actor.data.items.filter((item) => {
    const spellMatch = ddbSpells.find((s) =>
      s.name === item.name &&
      item.data.data.preparation?.mode === "prepared" &&
      item.data.flags.ddbimporter?.dndbeyond?.characterClassId &&
      item.data.flags.ddbimporter?.dndbeyond?.characterClassId === s.flags.ddbimporter?.dndbeyond?.characterClassId
    );
    if (!spellMatch) return false;
    const select = item.type === "spell" &&
      item.data.data.preparation?.mode === "prepared" &&
      item.data.data.preparation.prepared !== spellMatch.data.preparation?.prepared;
    return spellMatch && select;
  }).map((spell) => {
    let spellPreparedData = {
        spellInfo: {
          spellId: spell.data.flags.ddbimporter.definitionId,
          characterClassId: spell.data.flags.ddbimporter.dndbeyond.characterClassId,
          entityTypeId: spell.data.flags.ddbimporter.entityTypeId,
          id: spell.data.flags.ddbimporter.id,
          prepared: false,
        }
    };
    if (spell.data.data.preparation.prepared) spellPreparedData.spellInfo.prepared = true;
    return spellPreparedData;
  });

  let promises = [];
  preparedSpells.forEach((spellPreparedData) => {
    // console.warn(spellPreparedData);
    // promises.push(spellPreparedData);
    promises.push(updateSpellsPrepared(actor, spellPreparedData));
  });

  return Promise.all(promises);

}


async function generateItemsToAdd(actor, itemsToAdd) {
  const results = {
    items: [],
    toAdd: [],
    custom: [],
  };

  for (let i = 0; i < itemsToAdd.length; i++) {
    let item = itemsToAdd[i];
    if (item.flags.ddbimporter?.definitionId && item.flags.ddbimporter?.definitionEntityTypeId) {
      results.toAdd.push({
        containerEntityId: parseInt(actor.data.flags.ddbimporter?.dndbeyond?.characterId),
        containerEntityTypeId: parseInt("1581111423"),
        entityId: parseInt(item.flags.ddbimporter.definitionId),
        entityTypeId: parseInt(item.flags.ddbimporter.definitionEntityTypeId),
        quantity: parseInt(item.data.quantity),
      });
    } else {
      // eslint-disable-next-line no-await-in-loop
      const ddbCompendiumMatch = await getCompendiumItemInfo(item);
      logger.debug(`Found item`, ddbCompendiumMatch);
      if (ddbCompendiumMatch &&
        ddbCompendiumMatch.flags?.ddbimporter?.definitionId &&
        ddbCompendiumMatch.flags?.ddbimporter?.definitionEntityTypeId
      ) {
        logger.debug(`Adding ${item.name} from DDB compendium match:`, ddbCompendiumMatch);
        setProperty(item, "flags.ddbimporter.definitionId", ddbCompendiumMatch.flags.ddbimporter.definitionId);
        setProperty(item, "flags.ddbimporter.definitionEntityTypeId", ddbCompendiumMatch.flags.ddbimporter.definitionEntityTypeId);
        setProperty(item, "name", ddbCompendiumMatch.name);
        setProperty(item, "type", ddbCompendiumMatch.type);
        results.toAdd.push({
          containerEntityId: parseInt(actor.data.flags.ddbimporter?.dndbeyond?.characterId),
          containerEntityTypeId: parseInt("1581111423"),
          entityId: parseInt(ddbCompendiumMatch.flags.ddbimporter.definitionId),
          entityTypeId: parseInt(ddbCompendiumMatch.flags.ddbimporter.definitionEntityTypeId),
          quantity: parseInt(item.data.quantity),
        });
      } else {
        results.custom.push(item);
      }
    }
    results.items.push(item);
  }
  return new Promise((resolve) => {
    resolve(results);
  });
}

async function addDDBEquipment(actor, itemsToAdd) {
  const generatedItemsToAddData = await generateItemsToAdd(actor, itemsToAdd);

  logger.debug(`Generated items data`, generatedItemsToAddData);

  const addItemData = {
    equipment: generatedItemsToAddData.toAdd,
  };

  if (addItemData.equipment.length > 0) {
    const itemResults = await updateCharacterCall(actor, "equipment/add", addItemData);
    try {
      const itemUpdates = itemResults.data.addItems
        .filter((addedItem) => itemsToAdd.some((i) =>
          i.flags.ddbimporter &&
          i.flags.ddbimporter.definitionId === addedItem.definition.id &&
          i.flags.ddbimporter.definitionEntityTypeId === addedItem.definition.entityTypeId
        ))
        .map((addedItem) => {
          let updatedItem = itemsToAdd.find((i) =>
            i.flags.ddbimporter &&
            i.flags.ddbimporter.definitionId === addedItem.definition.id &&
            i.flags.ddbimporter.definitionEntityTypeId === addedItem.definition.entityTypeId
          );
          setProperty(updatedItem, "flags.ddbimporter.id", addedItem.id);
          return updatedItem;
        });

      logger.debug("Character item updates:", itemUpdates);

      try {
        await actor.updateEmbeddedDocuments("Item", itemUpdates);
      } catch (err) {
        logger.error(`Unable to update character with equipment, got the error:`, err);
        logger.error(`Update payload:`, itemUpdates);
      }

    } catch (err) {
      logger.error(`Unable to filter updated equipment, got the error:`, err);
      logger.error(`itemsToAdd`, itemsToAdd);
      logger.error(`equipmentToAdd`, generatedItemsToAddData);
      logger.error(`itemResults`, itemResults);
    }

    return itemResults;
  } else {
    return [];
  }
}

async function addEquipment(actor, ddbData) {
  const syncItemReady = actor.data.flags.ddbimporter?.syncItemReady;
  if (syncItemReady && !game.settings.get("ddb-importer", "sync-policy-equipment")) return [];
  const ddbItems = ddbData.character.inventory;

  const itemsToAdd = actor.data.items.filter((item) =>
    !item.data.flags.ddbimporter?.action &&
    item.data.data.quantity !== 0 &&
    DICTIONARY.types.inventory.includes(item.type) &&
    !item.data.flags.ddbimporter?.custom &&
    (!item.data.flags.ddbimporter?.id ||
    !ddbItems.some((s) => s.flags.ddbimporter?.id === item.data.flags.ddbimporter?.id && s.type === item.type))
  ).map((item) => item.toObject());

  return addDDBEquipment(actor, itemsToAdd);
}

// updates names of items and actions
async function updateCustomNames(actor, ddbData) {
  const syncItemReady = actor.data.flags.ddbimporter?.syncItemReady;
  if (syncItemReady && !game.settings.get("ddb-importer", "sync-policy-equipment")) return [];
  const ddbItems = ddbData.character.inventory;

  const itemsToName = actor.data.items.filter((item) =>
    item.data.data.quantity !== 0 &&
    (DICTIONARY.types.inventory.includes(item.type) || item.data.flags.ddbimporter?.action) &&
    item.data.flags.ddbimporter?.id &&
    // item.data.flags.ddbimporter?.entityTypeId &&
    ddbItems.some((s) =>
      s.flags.ddbimporter?.id === item.data.flags.ddbimporter.id &&
      s.type === item.type && s.name !== item.name
    )
  ).map((item) => item.toObject());

  let promises = [];

  itemsToName.forEach((item) => {
    const customData = {
      customValues: {
        characterId: parseInt(actor.data.flags.ddbimporter.dndbeyond.characterId),
        contextId: null,
        contextTypeId: null,
        notes: null,
        typeId: 8,
        value: item.name,
        valueId: `${item.flags.ddbimporter.id}`,
        valueTypeId: `${item.flags.ddbimporter.entityTypeId}`,
      }
    };
    promises.push(updateCharacterCall(actor, "equipment/custom", customData));
  });

  return Promise.all(promises);
}

async function removeEquipment(actor, ddbData) {
  const syncItemReady = actor.data.flags.ddbimporter?.syncItemReady;
  if (syncItemReady && !game.settings.get("ddb-importer", "sync-policy-equipment")) return [];
  const ddbItems = ddbData.character.inventory;

  const itemsToRemove = ddbItems.filter((item) =>
    (!actor.data.items.some((s) => (item.flags.ddbimporter?.id === s.data.flags.ddbimporter?.id && s.type === item.type) && !s.data.flags.ddbimporter?.action) ||
    actor.data.items.some((s) => (item.flags.ddbimporter?.id === s.data.flags.ddbimporter?.id && s.type === item.type) && !s.data.flags.ddbimporter?.action && s.data.data.quantity == 0)) &&
    DICTIONARY.types.inventory.includes(item.type) &&
    item.flags.ddbimporter?.id
  );

  let promises = [];

  itemsToRemove.forEach((item) => {
    promises.push(updateCharacterCall(actor, "equipment/remove", { itemId: parseInt(item.flags.ddbimporter.id) }));
  });

  return Promise.all(promises);
}

async function updateDDBEquipmentStatus(actor, updateItemDetails, ddbItems) {
  const itemsToEquip = updateItemDetails.itemsToEquip || [];
  const itemsToAttune = updateItemDetails.itemsToAttune || [];
  const itemsToCharge = updateItemDetails.itemsToCharge || [];
  const itemsToQuantity = updateItemDetails.itemsToQuantity || [];
  const itemsToName = updateItemDetails.itemsToName || [];

  let promises = [];

  itemsToEquip.forEach((item) => {
    const itemData = { itemId: item.data.flags.ddbimporter.id, value: item.data.data.equipped };
    promises.push(updateCharacterCall(actor, "equipment/equipped", itemData));
  });
  itemsToAttune.forEach((item) => {
    const itemData = { itemId: item.data.flags.ddbimporter.id, value: (item.data.data.attunement === 2) };
    promises.push(updateCharacterCall(actor, "equipment/attuned", itemData));
  });
  itemsToCharge.forEach((item) => {
    const itemData = {
      itemId: item.data.flags.ddbimporter.id,
      charges: parseInt(item.data.data.uses.max) - parseInt(item.data.data.uses.value),
    };
    promises.push(updateCharacterCall(actor, "equipment/charges", itemData));
  });
  itemsToQuantity.forEach((item) => {
    const itemData = {
      itemId: item.data.flags.ddbimporter.id,
      quantity: parseInt(item.data.data.quantity),
    };
    promises.push(updateCharacterCall(actor, "equipment/quantity", itemData));
  });
  itemsToName.forEach((item) => {
    // historically items may not have this metadata
    const entityTypeId = item.data?.flags?.ddbimporter?.entityTypeId
      ? item.data.flags.ddbimporter.entityTypeId
      : ddbItems.find((dItem) => dItem.id === item.data.flags.ddbimporter.id).entityTypeId;
    const customData = {
      customValues: {
        characterId: parseInt(actor.data.flags.ddbimporter.dndbeyond.characterId),
        contextId: null,
        contextTypeId: null,
        notes: null,
        typeId: 8,
        value: item.name,
        valueId: `${item.data.flags.ddbimporter.id}`,
        valueTypeId: `${entityTypeId}`,
      }
    };
    promises.push(updateCharacterCall(actor, "equipment/custom", customData));
  });

  return Promise.all(promises);
}


async function equipmentStatus(actor, ddbData, addEquipmentResults) {
  const syncItemReady = actor.data.flags.ddbimporter?.syncItemReady;
  if (syncItemReady && !game.settings.get("ddb-importer", "sync-policy-equipment")) return [];
  // reload the actor following potential updates to equipment
  let ddbItems = ddbData.ddb.character.inventory;
  if (addEquipmentResults?.data) {
    actor = game.actors.get(actor.id);
    ddbItems = ddbItems.concat(addEquipmentResults.data.addItems);
  }

  const itemsToEquip = actor.data.items.filter((item) =>
    !item.data.flags.ddbimporter?.action && item.data.flags.ddbimporter?.id &&
    ddbItems.some((dItem) =>
      item.data.flags.ddbimporter.id === dItem.id &&
      dItem.id === item.data.flags.ddbimporter?.id &&
      item.data.data.equipped !== dItem.equipped
    )
  );
  const itemsToAttune = actor.data.items.filter((item) =>
    !item.data.flags.ddbimporter?.action && item.data.flags.ddbimporter?.id &&
    ddbItems.some((dItem) =>
      item.data.flags.ddbimporter.id === dItem.id &&
      dItem.id === item.data.flags.ddbimporter?.id &&
      ((item.data.data.attunement === 2) !== dItem.isAttuned)
    )
  );
  const itemsToCharge = actor.data.items.filter((item) =>
    !item.data.flags.ddbimporter?.action && item.data.flags.ddbimporter?.id &&
    ddbItems.some((dItem) =>
      item.data.flags.ddbimporter.id === dItem.id &&
      dItem.id === item.data.flags.ddbimporter?.id &&
      item.data.data.uses?.max && dItem.limitedUse?.numberUsed &&
      ((parseInt(item.data.data.uses.max) - parseInt(item.data.data.uses.value)) !== dItem.limitedUse.numberUsed)
    )
  );
  // need to handle weapon and armor separately, as they get added as new items (not implemented)
  const itemsToQuantity = actor.data.items.filter((item) =>
    !item.data.flags.ddbimporter?.action && item.data.flags.ddbimporter?.id &&
    !item.data.data.quantity == 0 &&
    item.type !== "weapon" && !item.data.data?.armor?.type &&
    ddbItems.some((dItem) =>
      item.data.flags.ddbimporter.id === dItem.id &&
      dItem.id === item.data.flags.ddbimporter?.id &&
      item.data.data.quantity !== dItem.quantity
    )
  );
  // this is for items that have been added and might have a different name
  const itemsToName = actor.data.items.filter((item) =>
    item.data.flags.ddbimporter?.id &&
    item.data.data.quantity !== 0 &&
    ddbItems.some((dItem) =>
      // item.data.flags.ddbimporter.id === dItem.id &&
      item.data.flags.ddbimporter.originalName === dItem.definition.name &&
      item.data.flags.ddbimporter.originalName !== item.data.name &&
      dItem.id === item.data.flags.ddbimporter?.id &&
      item.data.name !== dItem.definition.name
    )
  );

  const itemsToUpdate = {
    itemsToEquip,
    itemsToAttune,
    itemsToCharge,
    itemsToQuantity,
    itemsToName,
  };

  return updateDDBEquipmentStatus(actor, itemsToUpdate, ddbItems);

}

async function actionStatus(actor, ddbData) {
  const syncActionReady = actor.data.flags.ddbimporter?.syncActionReady;
  if (syncActionReady && !game.settings.get("ddb-importer", "sync-policy-action-use")) return [];

  let ddbActions = ddbData.character.actions;

  const actionsToCharge = actor.data.items.filter((item) =>
    (item.data.flags.ddbimporter?.action || item.type === "feat") &&
    item.data.flags.ddbimporter?.id && item.data.flags.ddbimporter?.entityTypeId &&
    ddbActions.some((dItem) =>
      item.data.flags.ddbimporter.id === dItem.flags.ddbimporter.id &&
      item.data.flags.ddbimporter.entityTypeId === dItem.flags.ddbimporter.entityTypeId &&
      item.name === dItem.name && item.type === dItem.type &&
      item.data.data.uses?.value &&
      item.data.data.uses.value !== dItem.data.uses.value
    )
  );

  let promises = [];

  actionsToCharge.forEach((action) => {
    const actionData = {
      actionId: action.data.flags.ddbimporter.id,
      entityTypeId: action.data.flags.ddbimporter.entityTypeId,
      uses: parseInt(action.data.data.uses.max) - parseInt(action.data.data.uses.value)
    };
    promises.push(updateCharacterCall(actor, "action/use", actionData));
  });

  return Promise.all(promises);
}

export async function updateDDBCharacter(actor) {
  const cobaltCheck = await checkCobalt(actor.id);

  if (cobaltCheck.success) {
    logger.debug(`Cobalt checked`);
  } else {
    logger.error(`Cobalt cookie expired, please reset`);
    logger.error(cobaltCheck.message);
    throw cobaltCheck.message;
  }

  const characterId = actor.data.flags.ddbimporter.dndbeyond.characterId;
  const syncId = actor.data.flags["ddb-importer"]?.syncId ? actor.data.flags["ddb-importer"].syncId + 1 : 0;
  let ddbData = await getCharacterData(characterId, syncId, actor.id);

  logger.debug("Current actor:", actor.data);
  logger.debug("DDB Parsed data:", ddbData);

  let singlePromises = []
    .concat(
      currency(actor, ddbData),
      hitPoints(actor, ddbData),
      hitDice(actor, ddbData),
      spellSlots(actor, ddbData),
      spellSlotsPact(actor, ddbData),
      inspiration(actor, ddbData),
      exhaustion(actor, ddbData),
      deathSaves(actor, ddbData),
      xp(actor, ddbData),
    ).flat();

  const singleResults = await Promise.all(singlePromises);
  const spellsPreparedResults = await spellsPrepared(actor, ddbData);
  const actionStatusResults = await actionStatus(actor, ddbData);
  const nameUpdateResults = await updateCustomNames(actor, ddbData);
  const addEquipmentResults = await addEquipment(actor, ddbData);
  const removeEquipmentResults = await removeEquipment(actor, ddbData);

  const equipmentStatusResults = await equipmentStatus(actor, ddbData, addEquipmentResults);

  // if a known/choice spellcaster
  // and new spell/ spells removed
  // for each spell add or remove, e.g.
  // const spellsData = {
  //   characterClassId: 52134801,
  //   spellId: 2019,
  //   id: 136157,
  //   entityTypeId: 435869154,
  //   remove: true,
  // };
  // const spellSlots = updateCharacterCall(actor, "spells", spellsData);
  // promises.push(spellSlots);

  actor.setFlag("ddb-importer", "syncId", syncId);

  // we can now process item attunements and uses (not yet done)

  const results = singleResults.concat(
    nameUpdateResults,
    addEquipmentResults,
    spellsPreparedResults,
    removeEquipmentResults,
    equipmentStatusResults,
    actionStatusResults
  ).filter((result) => result !== undefined);

  logger.debug("Update results", results);

  return results;
}

// Called when characters are updated
// will dynamically sync status back to DDB
async function activeUpdateActor(actor, update) {
  return new Promise((resolve) => {

    const dynamicSync = activeUpdate();
    const actoractiveUpdate = actor.data.flags.ddbimporter?.activeUpdate;

    console.warn("dynamicSync", dynamicSync);
    console.warn("actoractiveUpdate", actoractiveUpdate);
    if (!dynamicSync || !actoractiveUpdate) {
      resolve([]);
    } else {
      console.warn("actor",actor);
      console.warn("actorUpdate",update);
      resolve();
      if (update.data?.attributes?.hp) {
        console.warn("Updating DDB Hitpoints...");
        resolve(updateDDBHitPoints(actor));
      } else {
        // also handle:

        // currency
        // hit dice
        // spell slots pack
        // spell slots
        // inspiration
        // exhaustion
        // death saves
        // xp
        // spells prepared
        console.warn("Not Yet Implemented", update);
        resolve("NOT YET IMPLEMENTED");
      }
      resolve([]);
    }

  });
}

const DISABLE_FOUNDRY_UPGRADE = {
  applyFeatures: false,
  addFeatures: false,
  promptAddFeatures: false,
};

async function generateDynamicItemChange(actor, document, update) {
  const updateItemDetails = {
    itemsToEquip: [],
    itemsToAttune: [],
    itemsToCharge: [],
    itemsToQuantity: [],
    itemsToName: [],
  };

  console.warn("Document", document);
  console.warn("Update", update);
  if (update.data?.uses) {
    updateItemDetails.itemsToCharge.push(document);
  }
  if (update.data?.attunement) {
    updateItemDetails.itemsToAttune.push(document);
  }
  if (update.data?.quantity) {
    // if its a weapon or armor we actually need to push a new one
    if (document.type === "weapon" || document.type === "armor" && update.data.quantity > 1) {
      console.warn("Weapon or Armor Quantity Update triggers new item", update);

      await document.update({ data: { quantity: 1 } });
      let newDocument = JSON.parse(JSON.stringify(document.toObject()));
      delete newDocument._id;
      delete newDocument.flags.ddbimporter.id;
      console.warn(newDocument);
      let results = [];
      for (let i = 1; i < update.data.quantity; i++) {
        console.warn(`Adding item # ${i}`);
        let newDoc = await actor.createEmbeddedDocuments("Item", [newDocument], DISABLE_FOUNDRY_UPGRADE);
        results.push(newDoc);
        // new doc/item push to ddb handled elsewhere/new item hook
      }
      return results;
    } else {
      updateItemDetails.itemsToQuantity.push(document);
    }
  }
  if (update.data?.equipped) {
    updateItemDetails.itemsToEquip.push(document);
  }
  if (update.name) {
    updateItemDetails.itemsToName.push(document);
  }

  return updateDDBEquipmentStatus(actor, updateItemDetails, []);
}

// Called when characters items are updated
// will dynamically sync status back to DDB
async function activeUpdateUpdateItem(document, update) {
  return new Promise((resolve) => {

    const dynamicSync = activeUpdate();
    // we check to see if this is actually an embedded item
    const parentActor = document.parent;
    const actoractiveUpdate = parentActor && parentActor.data.flags.ddbimporter?.activeUpdate;

    if (!dynamicSync || !parentActor || !actoractiveUpdate) {
      resolve([]);
    } else {
      console.warn("Preparing to sync item change to DDB...");
      const action = document.data.flags.ddbimporter?.action || document.type === "feat";

      // is this a DDB action, or do we treat this as an item?
      if (action) {
        console.warn("Not Yet Implemented", update);
        resolve("NOT YET IMPLEMENTED");
        // actionStatus()
      } else {
        resolve(generateDynamicItemChange(parentActor, document, update));
      }
    }
  });
}


// Called when characters items are added
// will dynamically sync status back to DDB
async function activeUpdateAddItem(document, update) {
  return new Promise((resolve) => {

    const dynamicSync = activeUpdate();
    // we check to see if this is actually an embedded item
    const parentActor = document.parent;
    const actoractiveUpdate = parentActor && parentActor.data.flags.ddbimporter?.activeUpdate;

    if (!dynamicSync || !parentActor || !actoractiveUpdate) {
      resolve([]);
    } else {
      console.warn("Preparing to add item to DDB...");
      const action = document.data.flags.ddbimporter?.action || document.type === "feat";
      if (!action) {
        console.warn("Attempting to add new Item");
        console.warn("docment", document);
        resolve(addDDBEquipment(parentActor, [document.toObject()]));
        // still need to handle item status updates
      }
    }
  });
}

// Called when characters items are added
// will dynamically sync status back to DDB
async function activeUpdateDeleteItem(document, update) {
  return new Promise((resolve) => {

    const dynamicSync = activeUpdate();
    // we check to see if this is actually an embedded item
    const parentActor = document.parent;
    const actoractiveUpdate = parentActor && parentActor.data.flags.ddbimporter?.activeUpdate;

    if (!dynamicSync || !parentActor || !actoractiveUpdate) {
      resolve([]);
    } else {
      console.warn("Preparing to delete item from DDB...");
      const action = document.data.flags.ddbimporter?.action || document.type === "feat";
      if (action) {
        console.warn("Not Yet Implemented", update);
        resolve("NOT YET IMPLEMENTED");
      } else {
        console.warn("Not Yet Implemented", update);
        resolve("NOT YET IMPLEMENTED");
      }
    }

  });
}

export function activateUpdateHooks() {
  if (activeUpdate()) {
    Hooks.on("updateActor", activeUpdateActor);
    Hooks.on("updateItem", activeUpdateUpdateItem);
    Hooks.on("deleteItem", activeUpdateDeleteItem);
    Hooks.on("createItem", activeUpdateAddItem);
  }
}
