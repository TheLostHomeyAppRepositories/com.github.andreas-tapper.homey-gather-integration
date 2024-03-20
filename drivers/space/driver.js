'use strict';

const { Driver } = require('homey');

class SpaceDriver extends Driver {
  async onInit() {
    const self = this;

    self.log('Starting initialization of the Gather space driver.');

    const aloneConditionCard = self.homey.flow.getConditionCard("alone");
    aloneConditionCard.registerRunListener(async ({ device, message }) => {
      self.log("IsAlone", device);
      return device.isAlone;
    });

    const presentConditionCard = self.homey.flow.getConditionCard("present");
    presentConditionCard.registerRunListener(async ({ device, message }) => {
      self.log("IsPresent", device);
      return device.isPresent;
    });

    const isConnectedConditionCard = self.homey.flow.getConditionCard("is-connected");
    isConnectedConditionCard.registerRunListener(async ({ device, message }) => {
      self.log("IsConnect", device);
      return device.isConnected;
    });

    const connectActionCard = self.homey.flow.getActionCard("connect");
    connectActionCard.registerRunListener(async ({ device, message }) => {
      self.log("Connect", device);
      await device.connect();
    });

    const disconnectActionCard = self.homey.flow.getActionCard("disconnect");
    disconnectActionCard.registerRunListener(async ({ device, message }) => {
      self.log("Disconnect", device);
      await device.disconnect();
    });

    self.log('Initialization of the Gather space driver completed.');
  }

  async onPair(session) {
    const self = this;

    session.setHandler("showView", async (viewId) => {
      if (viewId === "configuration_view") {
        await session.emit("has_token", !!self.homey.settings.get("token"));
      }
    });

    session.setHandler("save_token", async function (data) {
      self.homey.settings.set("token", data.token);
    });

    await session.showView("configuration_view");
  }

  async onPairListDevices() {
    return [];
  }
}

module.exports = SpaceDriver;
