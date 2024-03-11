'use strict';

const Homey = require('homey');
const { ramda } = require('ramda');
const { Game, ServerClientEvent } = require('@gathertown/gather-game-client');
global.WebSocket = require("isomorphic-ws");

class GatherApp extends Homey.App {
  // Homey cards
  #doorbellRingsCard;
  #incomingWaveCard;
  #connectionStatusCard;
  #presenceStatusCard;

  // Gather integration
  #game;
  #isConnected = false;
  #avatarName;
  #player;
  #playerPrivateSpaceId;

  get me() {
    const self = this;

    if (self.#player) {
      return self.#player;
    }

    const players = this.#game.filterPlayersInSpace(player => player.name == self.#avatarName);
    return self.#player = (players.length > 0 ? players[0] : null);
  }

  get myPrivateSpaceId() {
    const self = this;

    if (self.#playerPrivateSpaceId) {
      return self.#playerPrivateSpaceId;
    }

    return self.#playerPrivateSpaceId = self.#gatherPlayerInPrivateSpace(self.me);
  }

  async onInit() {
    const self = this;

    self.log('Starting initialization of the Gather integration.');

    // Flow cards
    self.#doorbellRingsCard = self.homey.flow.getTriggerCard("doorbell-rings");
    self.#incomingWaveCard = self.homey.flow.getTriggerCard("incoming-wave");
    self.#connectionStatusCard = self.homey.flow.getTriggerCard("connection-status");
    self.#presenceStatusCard = self.homey.flow.getTriggerCard("presence-status");

    const aloneConditionCard = self.homey.flow.getConditionCard("alone");
    aloneConditionCard.registerRunListener(async () => {
      return self.me?.isAlone == true;
    });

    const presentConditionCard = self.homey.flow.getConditionCard("present");
    presentConditionCard.registerRunListener(async () => {
      return self.me?.away == false;
    });

    const isConnectedConditionCard = self.homey.flow.getConditionCard("is-connected");
    isConnectedConditionCard.registerRunListener(async () => {
      return !!self.#game && self.#isConnected;
    });

    const connectActionCard = self.homey.flow.getActionCard("connect");
    connectActionCard.registerRunListener(async () => {
      await self.#connectToGather();
    });

    const disconnectActionCard = self.homey.flow.getActionCard("disconnect");
    disconnectActionCard.registerRunListener(async () => {
      await self.#disconnectFromGather();
    });

    // Gather integration
    await self.#connectToGather();

    self.log('Initialization of the Gather integration completed.');
  }

  async onUninit() {
    await this.#disconnectFromGather();
  }

  async #connectToGather() {
    const self = this;

    if (!!self.#game) {
      self.log("Gather game already initiated.")
      return;
    }

    const url = 'https://app.gather.town/app/';

    const apiKey = this.homey.settings.get("gatherToken") || Homey.env.GATHER_TOKEN;
    let spaceId = this.homey.settings.get("spaceId") || Homey.env.SPACE_ID;
    self.#avatarName = self.homey.settings.get("avatarName") || Homey.env.AVATAR_NAME;

    // Trim url and replace slashes with backslashes to convert from the in-browser path to API space id path
    if(spaceId.startsWith(url)) {
      spaceId = spaceId.substring(url.length);
    }
    spaceId = spaceId.replaceAll('/', '\\');

    if(!apiKey || !spaceId) {
      throw new Error("Api key or space isn't defined.");
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

  async #disconnectFromGather() {
    const self = this;
    
    if (!self.#game) {
      return;
    }

    await self.#game.disconnect();
    self.#game = null;
  }

  #gatherConnection() {
    const self = this;
    return (connected) => {
      self.log(`Gather connection ${(connected ? 'established' : 'failed')}.`);
      self.#isConnected = connected;
      self.#connectionStatusCard.trigger({ connected: connected });
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
      if (self.me?.id == context.playerId) {
        self.#playerPrivateSpaceId = null;
      }
    };
  }

  #gatherPlayerRings() {
    const self = this;
    return (data, context) => {
      self.log(`${context?.player?.name} is ringing you.`);
      self.#doorbellRingsCard.trigger({ person: context?.player?.name });
    }
  }

  #gatherPlayerSetsIsAlone() {
    const self = this;

    return (data, context) => {
      const privateSpaceId = self.#gatherPlayerInPrivateSpace(context?.player);

      if (!self.me) {
        return;
      }

      if (self.me.id != context.playerId && privateSpaceId != self.myPrivateSpaceId) {
        return;
      }

      let others = "";
      if (self.myPrivateSpaceId) {
        others = self.#game.filterPlayersInSpace(player => player.id != self.me.id && self.#game.isPlayerInPrivateSpace(player, self.me.map, self.myPrivateSpaceId))
          .map(player => player.name)
          .join(', ');
      }

      if (self.me.isAlone) {
        self.log(`You are now alone at '${self.myPrivateSpaceId}'.`);
      } else {
        self.log(`You are joined by ${others} at '${self.myPrivateSpaceId}'.`);
        self.#presenceStatusCard.trigger({
          alone: self.me.isAlone,
          away: self.me.away,
          persons: others
        });
      }
    }
  }

  #gatherPlayerWaves() {
    const self = this;
    return (data, context) => {
      const targetId = context?.player?.targetId;

      if (self.me?.id == targetId) {
        self.log(`${context?.player?.name} waves to you.`);
        self.#incomingWaveCard.trigger({ person: context?.player?.name });
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

module.exports = GatherApp;
