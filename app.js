'use strict';

const Homey = require('homey');
const { ramda } = require('ramda');
const { Game, ServerClientEvent } = require('@gathertown/gather-game-client');
global.WebSocket = require("isomorphic-ws");

class GatherApp extends Homey.App {

  /**
   * onInit is called when the app is initialized.
   */
  async onInit() {
    this.log('Starting initialization of the Gather integration.');

    const self = this;
    const apiKey = this.homey.settings.get("gatherToken") || Homey.env.GATHER_TOKEN;
    const spaceId = this.homey.settings.get("spaceId") || Homey.env.SPACE_ID;
    const avatarName = this.homey.settings.get("avatarName") || Homey.env.AVATAR_NAME;
    let isAlone = true;

    // Flow cards
    const incomingCallCard = this.homey.flow.getTriggerCard("incoming-call");
    const incomingWaveCard = this.homey.flow.getTriggerCard("incoming-wave");
    const connectionStatusCard = this.homey.flow.getTriggerCard("connection-status");
    const notAloneCard = this.homey.flow.getTriggerCard("not-alone");

    // Gather integration
    const game = new Game(spaceId, () => Promise.resolve({ apiKey: apiKey }));
    game.connect();
    game.subscribeToConnection((connected) => {
      self.log(`Gather connection ${(connected ? 'established' : 'failed')}.`);
      connectionStatusCard.trigger({ connected: connected });
    });

    game.subscribeToEvent("playerRings", (data, context) => {
      self.log(`${context?.player?.name} is calling you.`);
      incomingCallCard.trigger({ caller: context?.player?.name });
    });


    game.subscribeToEvent("playerSetsIsAlone", (data, context) => {
      if (avatarName != context?.player?.name) {
        return;
      }

      isAlone = !!context?.player?.isAlone;

      // You are not alone anymore
      if (!isAlone) {
        self.log("You are not alone anymore.");

        // Raise an alert if you are away
        if(context?.player?.away) {
          notAloneCard.trigger();
        }
      }
    });

    game.subscribeToEvent("playerWaves", (data, context) => {
      self.log(`${context?.player?.name} waves to you.`);
      incomingWaveCard.trigger({ person: context?.player?.name });
    });

    this.log('Initialization of the Gather integration completed.');
  }

}

module.exports = GatherApp;
