const NodeHelper = require("node_helper");
const ping = require("ping");
const mqtt = require("mqtt");
const Log = require("logger");
const path = require("path");

module.exports = NodeHelper.create(path.basename(__dirname), {
  name: path.basename(__dirname),
  logPrefix: `${path.basename(__dirname)} ::`,
  messagePrefix: `${path.basename(__dirname)}-`,
  defaults: {
    pingTarget: null,
    broker: null,
    waitTime: 60,
    monitorTopic: "state/monitor/STATE",
    ledsTopic: "wled/all/api",
    scenarioTopic: null,
    targetTopics: []
  },
  states: {
    on: "ON",
    off: "OFF",
    idle: "IDLE"
  },
  config: {},
  lastSeen: null,
  client: null,
  notifiedOn: false,
  notifiedOff: false,
  notifiedIdle: false,
  connected: false,

  start: function () {
    this.config = {
      ...this.defaults,
      ...this.config
    };
    this.client = null;
    this.lastSeen = this._now();
    this.state = this.states.off;
    this.connected = false;
    this.connectToBroker();
    this.log("Started");
  },

  // Logging wrapper
  log: function (...args) {
    Log.log(this.logPrefix, ...args);
  },
  info: function (...args) {
    Log.info(this.logPrefix, ...args);
  },
  debug: function (...args) {
    Log.debug(this.logPrefix, ...args);
  },
  error: function (...args) {
    Log.error(this.logPrefix, ...args);
  },
  warning: function (...args) {
    Log.warning(this.logPrefix, ...args);
  },

  _now() {
    return Math.floor(Date.now() / 1000);
  },

  checkConfig: function (...args) {
    return args.reduce(
      (acc, o) =>
        Object.prototype.hasOwnProperty.call(this.config, o) &&
        this.config[o] !== null &&
        acc,
      true
    );
  },

  connectToBroker: function () {
    if (!this.checkConfig("broker")) {
      setTimeout(() => this.connectToBroker(), 500);
      return;
    }

    this.client = mqtt.connect(this.config.broker);

    this.client.on("connect", () => {
      this.connected = true;
      this.log("Connected to MQTT broker");
      this.monitorLoop();
    });

    this.client.on("error", (error) => {
      this.error("MQTT Error", error.toString());
      this.client.close();
    });

    this.client.on("close", () => {
      this.connected = false;
      this.warning("MQTT connection closed. Reconnecting...");
      setTimeout(() => this.connectToBroker(), 500);
    });
  },

  monitorLoop: function () {
    if (!this.checkConfig("pingTarget", "monitorTopic")) {
      setInterval(() => this.monitorLoop(), 500);
      return;
    }

    this.publishMessage(this.config.monitorTopic, this.states.on);

    ping.promise
      .probe(this.config.pingTarget, { min_reply: 1, timeout: 1 })
      .then((res) => {
        const lastState = `${this.state}`;
        const counter = this._now() - this.lastSeen;
        if (res.alive) {
          this.lastSeen = this._now();
          this.state = this.state.on;
        } else if (counter < this.config.waitTime) this.state = this.state.idle;
        else if (counter >= this.config.waitTime) this.state = this.state.off;

        if (this.state !== lastState) this.log(`Detected ${this.state}`);
        [
          this.config.ledsTopic,
          this.config.scenarioTopic,
          ...this.config.targetTopics
        ]
          .filter((t) => t !== null && `${t}`.trim().length > 0)
          .forEach((t) => {
            switch (t) {
              case this.config.ledsTopic:
                if (this.state === this.states.off)
                  this.publishMessage(t, "PL=1");
                break;
              case this.config.scenarioTopic:
                this.publishMessage(t, this.state);
                break;
              default:
                if ([this.states.on, this.states.off].includes(this.state))
                  this.publishMessage(t, this.state);
            }
          });
      })
      .catch(() => void 0)
      .finally(() => {
        this._sendNotification("STATE", this.state);
        setInterval(() => this.monitorLoop(), 1000);
      });
  },

  publishMessage: function (topic, message) {
    if (!this.client) return;
    this.client.publish(topic, message, (error) => {
      if (error) {
        this.error("Error publishing MQTT message", error.toString());
      }
    });
  },

  _sendNotification(notification, payload) {
    this.sendSocketNotification(
      `${this.messagePrefix}${notification}`,
      payload
    );
  },

  _notificationReceived(notification, payload) {
    switch (notification) {
      case "SET_CONFIG":
        try {
          let changed = false;
          Object.entries({
            ...this.defaults,
            ...this.config,
            ...payload
          }).forEach(([k, v]) => {
            if (this.config[k] === v) return;
            this.config[k] == v;
            changed = true;
          });
          if (changed) this.log("Config settled");
        } catch (_) {
          this.error("Invalid config", JSON.stringify(payload, null, 2));
        }
      default:
    }
  },

  socketNotificationReceived: function (notification, payload) {
    this._notificationReceived(
      notification.replace(new RegExp(`^${this.messagePrefix}`, "gi"), ""),
      payload
    );
  }
});
