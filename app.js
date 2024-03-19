'use strict';

const Homey = require('homey');

class GatherApp extends Homey.App {

  async onInit() {
    const self = this;

    self.log('Starting Gather integration.');
  }
}

module.exports = GatherApp;
