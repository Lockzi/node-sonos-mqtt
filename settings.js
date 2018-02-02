'use strict';
const fs = require('fs');
const path = require('path');
const logger = require('sonos-discovery/lib/helpers/logger');
const tryLoadJson = require('sonos-http-api/lib/helpers/try-load-json');

function merge(target, source) {
  Object.keys(source).forEach((key) => {
    if ((Object.getPrototypeOf(source[key]) === Object.prototype) && (target[key] !== undefined)) {
      merge(target[key], source[key]);
    } else {
      target[key] = source[key];
    }
  });
}

var settings = {
  port: 5005,
  securePort: 5006,
  announceVolume: 40,

  MQTT: {
    connection: {
      url: "mqtt://localhost",
      username: "username",
      password: "password",
      clean: false,
      clientId: "sonos",
      keepalive: 10000,
      protocolId: "MQIsdp",   // Needed only for Mosquitto < 1.3
      protocolVersion: 3      // ""
    },
    prefix: "sonos/"
  }
}

// load user settings
const settingsFileFullPath = path.resolve(__dirname, 'settings.json');
const userSettings = tryLoadJson(settingsFileFullPath);
merge(settings, userSettings);

logger.debug(settings);


module.exports = settings;
