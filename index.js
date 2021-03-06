/* Accept self signed certificate */
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

const SonosSystem = require('sonos-discovery')
const SonosHttpAPI = require('sonos-http-api/lib/sonos-http-api.js')
const SonosSettings = require('sonos-http-api/settings')
const settings = require('./settings.js')
const nodeStatic = require('node-static')
const http = require('http')
const requireDir = require('sonos-http-api/lib/helpers/require-dir')
const path = require('path')
const mqtt = require('mqtt')

function merge(target, source) {
  Object.keys(source).forEach((key) => {
    if ((Object.getPrototypeOf(source[key]) === Object.prototype) && (target[key] !== undefined)) {
      merge(target[key], source[key]);
    } else {
      target[key] = source[key];
    }
  });
}

console.log("SonosSettings");
console.log(SonosSettings);


console.log("settings");
console.log(settings);
// load user settings
merge(settings, SonosSettings);

const client = mqtt.connect(settings.MQTT.connection.url, {
  username: settings.MQTT.connection.username,
  password: settings.MQTT.connection.password,
  clean: settings.MQTT.connection.clean,
  clientId: settings.MQTT.connection.clientId,
  keepalive: settings.MQTT.connection.keepalive,
  protocolId: settings.MQTT.connection.protocolId,   // Needed only for Mosquitto < 1.3
  protocolVersion: settings.MQTT.connection.protocolVersion      // ""
})

client.on('connect', (msg) => console.log("mqtt - connected", msg))

client.on('error', (error) => console.error('mqtt - error', error))

client.on('close', () => console.error("mqtt - connection close"))

client.on('offline', () => console.log("mqtt - offline"))

const discovery = new SonosSystem(settings)

function SonosMQTTAPI(discovery, settings) {

  const port = settings.port
  const webroot = settings.webroot
  const actions = {}

  this.getWebRoot = () => webroot

  this.getPort = () => port

  this.discovery = discovery

  const player_related_events = [
    'group-mute',
    'transport-state',
    'group-volume',
    'volume-change',
    'mute-change',
  ]

  const system_related_events = [
    'list-change',
    'initialized',
    'topology-change',
  ]
  player_related_events.forEach(action =>
    discovery.on(action, player => {
      let topic = `${settings.MQTT.prefix}${player.roomName.toLowerCase().split(" ").join("")}/${action}`
      console.log("player Related: "+topic)
      console.log(JSON.stringify(player))
      client.publish(topic.toLowerCase(), JSON.stringify(player))
    })
  )
  system_related_events.forEach(action =>
    discovery.on(action, system => {
      let topic = `${settings.MQTT.prefix}system/${action}`
      console.log("system Related: "+topic)
      client.publish(topic.toLowerCase(), JSON.stringify(system))
    })
  )

  // this handles registering of all actions
  this.registerAction = (action, handler) => {
    client.subscribe(`${settings.MQTT.prefix}${action}`, {qos: 1})
    client.subscribe(`${settings.MQTT.prefix}${action}/#`, {qos: 1})
    actions[action] = handler
    console.log(action)
  }

  //load modularized actions
  requireDir(path.join(__dirname, './node_modules/sonos-http-api/lib/actions'), (registerAction) => {
    registerAction(this)
  })

  this.requestHandler = (topic, message) => {
    if (discovery.zones.length === 0) {
      console.error('System has yet to be discovered')
      return
    }

    const params = topic.replace(settings.MQTT.prefix, "").split('/')
    const opt = {}

    opt.player = discovery.getPlayer(params.pop())

    try {
      opt.values = JSON.parse(message.toString())

    }
    catch (e) {
      opt.values = [message.toString()]
    }

    opt.action = params[0]

    if (!opt.player) {
      opt.player = discovery.getAnyPlayer()
    }

    handleAction(opt)
      .then((response) => {
        if (!response || response.constructor.name === 'IncomingMessage') {
          response = {status: 'success'}
        } else if (Array.isArray(response) && response.length > 0 && response[0].constructor.name === 'IncomingMessage') {
          response = {status: 'success'}
        }
        sendResponse(response)
      }).catch((error) => {
      console.error(error)
      sendResponse({status: 'error', error: error.message, stack: error.stack})
    })

  }

  function handleAction(options) {
    let player = options.player

    if (!actions[options.action]) {
      return Promise.reject({error: 'action \'' + options.action + '\' not found'})
    }

    return actions[options.action](player, options.values)

  }

}

const sendResponse = body => {
  client.publish(`${settings.MQTT.prefix}out`, JSON.stringify(body), {qos: 1})
  console.log(body)
}

const api = new SonosMQTTAPI(discovery, settings)

const file = new nodeStatic.Server(settings.webroot)

http.createServer((request, response) =>
  request.addListener('end', () => file.serve(request, response)
  ).resume()
).listen(settings.port)

client.on('message', api.requestHandler)

module.exports = api