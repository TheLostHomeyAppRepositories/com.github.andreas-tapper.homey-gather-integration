'use strict';

const { Device } = require('homey');
const { ramda } = require('ramda');
const { Game, ServerClientEvent } = require('@gathertown/gather-game-client');
global.WebSocket = require("isomorphic-ws");

class SpaceDevice extends Device {

  // Gather integration
  #game;
  #isConnected = false;
  #avatarName;
  #player;
  #playerPrivateSpaceId;

  // Homey cards
  #doorbellRingsCard;
  #incomingWaveCard;
  #connectionStatusCard;
  #presenceStatusCard;

  get isConnected() {
    return !!this.#game && this.#isConnected;
  }

  get isPresent() {
    return this.#me()?.away == false;
  }

  get isAlone() {
    return this.#me()?.isAlone == true;
  }

  async onInit() {
    const self = this;

    self.log('Starting initialization of the Gather space device.');

    // Flow cards
    self.#doorbellRingsCard = self.homey.flow.getDeviceTriggerCard("doorbell-rings");
    self.#incomingWaveCard = self.homey.flow.getDeviceTriggerCard("incoming-wave");
    self.#connectionStatusCard = self.homey.flow.getDeviceTriggerCard("connection-status");
    self.#presenceStatusCard = self.homey.flow.getDeviceTriggerCard("presence-status");

    // Gather integration
    await self.connect();

    self.log('Initialization of the Gather space device completed.');
  }

  async onUninit() {
    await this.disconnect();
  }

  /**
   * onAdded is called when the user adds the device, called just after pairing.
   */
  async onAdded() {
    this.log('A gather space has been added.');
  }

  /**
   * onSettings is called when the user updates the device's settings.
   * @param {object} event the onSettings event data
   * @param {object} event.oldSettings The old settings object
   * @param {object} event.newSettings The new settings object
   * @param {string[]} event.changedKeys An array of keys changed since the previous version
   * @returns {Promise<string|void>} return a custom message that will be displayed
   */
  async onSettings({ oldSettings, newSettings, changedKeys }) {
    this.log('Space settings where changed', oldSettings, newSettings, changedKeys);
  }

  /**
   * onRenamed is called when the user updates the device's name.
   * This method can be used this to synchronise the name to the device.
   * @param {string} name The new name
   */
  async onRenamed(name) {
    this.log(`Space was renamed to '${name}'`);
  }

  /**
   * onDeleted is called when the user deleted the device.
   */
  async onDeleted() {
    this.log('Space has been deleted.');
  }

  async connect() {
    const self = this;

    if (!!self.#game) {
      self.log("Gather game already initiated.")
      return;
    }

    const url = 'https://app.gather.town/app/';
    const apiKey = self.homey.settings.get("token") || Homey.env.GATHER_TOKEN;

    if (!apiKey) {
      self.log("Failed to fetch API key.");
      throw new Error(self.homey.__("noApiKeyFound"));
    }

    const settings = self.getSettings();
    self.log("Using settings", settings);
    let spaceId = settings.spaceId || Homey.env.SPACE_ID;
    self.#avatarName = settings.avatarName || Homey.env.AVATAR_NAME;

    // Trim url and replace slashes with backslashes to convert from the in-browser path to API space id path
    if (spaceId.startsWith(url)) {
      spaceId = spaceId.substring(url.length);
    }
    spaceId = spaceId.replaceAll('/', '\\');

    if (!spaceId) {
      throw new Error(self.homey.__("device.spaceIdRequired"));
    }

    self.#game = new Game(spaceId, () => Promise.resolve({ apiKey: apiKey }));
    self.#game.subscribeToConnection(self.#gatherConnection());
    self.#game.subscribeToDisconnection(self.#gatherDisconnection());
    self.#game.subscribeToEvent("ready", self.#gatherIsReady());
    self.#game.subscribeToEvent("playerMoves", self.#gatherPlayerMoves());
    self.#game.subscribeToEvent("playerRings", self.#gatherPlayerRings());
    self.#game.subscribeToEvent("playerSetsIsAlone", self.#gatherPlayerSetsIsAlone());
    self.#game.subscribeToEvent("playerWaves", self.#gatherPlayerWaves());

    self.#game.connect();
  }

  async disconnect() {
    const self = this;

    if (!self.#game) {
      return;
    }

    await self.#game.disconnect();
    self.#game = null;
  }

  #me() {
    const self = this;

    if (self.#player) {
      return self.#player;
    }

    const players = this.#game.filterPlayersInSpace(player => player.name == self.#avatarName);
    return self.#player = (players.length > 0 ? players[0] : null);
  }

  #myPrivateSpaceId() {
    const self = this;

    if (self.#playerPrivateSpaceId) {
      return self.#playerPrivateSpaceId;
    }

    return self.#playerPrivateSpaceId = self.#gatherPlayerInPrivateSpace(self.#me());
  }

  #gatherConnection() {
    const self = this;
    return (connected) => {
      self.log(`Gather connection ${(connected ? 'established' : 'failed')}.`);
      self.#isConnected = connected;
      self.#connectionStatusCard.trigger(self, { connected: connected }).catch(function (error) {
        if (error) {
          self.log("Connection status card failed.", error);
        }
      });
    };
  }

  #gatherDisconnection() {
    const self = this;
    return (code, reason) => {
      self.log(`Gather was disconnected '${reason}' (${code}).`);

      self.#isConnected = false;
      self.#game = null;
      self.#avatarName = null;
      self.#player = null;
      self.#playerPrivateSpaceId = null;
    };
  }

  #gatherIsReady() {
    const self = this;
    return (data, context) => {
      self.log("Gather integration is ready.");
      self.log("Game statistics", self.#game.getStats());
    };
  }

  #gatherPlayerMoves() {
    const self = this;
    return (data, context) => {
      if (self.#me()?.id == context.playerId) {
        self.#playerPrivateSpaceId = null;
      }
    };
  }

  #gatherPlayerRings() {
    const self = this;
    return (data, context) => {
      self.log(`${context?.player?.name} is ringing you.`);
      self.#doorbellRingsCard.trigger(self, { person: context?.player?.name }).catch(function (error) {
        if (error) {
          self.log("Doorbell rings card failed.", error);
        }
      });
    }
  }

  #gatherPlayerSetsIsAlone() {
    const self = this;

    return (data, context) => {
      const privateSpaceId = self.#gatherPlayerInPrivateSpace(context?.player);
      const me = self.#me();

      if (!me) {
        return;
      }

      const myPrivateSpaceId = self.#myPrivateSpaceId();
      if (me.id != context.playerId && privateSpaceId != myPrivateSpaceId) {
        return;
      }

      let others = "";
      if (myPrivateSpaceId) {
        others = self.#game.filterPlayersInSpace(player => player.id != me.id && self.#game.isPlayerInPrivateSpace(player, me.map, myPrivateSpaceId))
          .map(player => player.name)
          .join(', ');
      }

      if (me.isAlone) {
        self.log(`You are now alone at '${myPrivateSpaceId}'.`);
      } else {
        self.log(`You are joined by ${others} at '${myPrivateSpaceId}'.`);
      }

      self.#presenceStatusCard.trigger(self, {
        alone: me.isAlone,
        away: me.away,
        persons: others
      }).catch(function (error) {
        if (error) {
          self.log("Presence status card failed.", error);
        }
      });      
    }
  }

  #gatherPlayerWaves() {
    const self = this;
    return (data, context) => {
      const targetId = context?.player?.targetId;
      const me = self.#me();

      if (me?.id == targetId) {
        self.log(`${context?.player?.name} waves to you.`);
        self.#incomingWaveCard.trigger(self, { person: context?.player?.name }).catch(function (error) {
          if (error) {
            self.log("Incoming wave card failed.", error);
          }
        });
      } else {
        const others = self.#game.filterPlayersInSpace(player => player.id == targetId);
        const playerName = others.length == 1 ? others[0].name : "unknown";
        self.log(`${context?.player?.name} waves to ${playerName}.`);
      }
    };
  }

  #gatherPlayerInPrivateSpace(player) {
    const self = this;

    if (!player) {
      return null;
    }

    let map = null;

    try {
      map = self.#game.completeMaps[player.map];
    } catch (error) {
      // This can occur in the beginning when the map isn't fully setup.
    }

    if (!map) {
      return null;
    }

    for (const id in map.nooks) {
      const nook = map.nooks[id];
      if (!!nook.nookCoords.coords.some((c) => c.x === player.x && c.y === player.y)) {
        return id;
      }
    }

    return null;
  }
}

module.exports = SpaceDevice;
