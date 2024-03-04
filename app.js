'use strict';

const Homey = require('homey');

class GatherApp extends Homey.App {

  /**
   * onInit is called when the app is initialized.
   */
  async onInit() {
    this.log('MyApp has been initialized');

    const incomingCallCard = this.homey.flow.getTriggerCard("incoming-call");
    incomingCallCard.trigger({
        caller: "John Doe"
    });
  }

}

module.exports = GatherApp;
