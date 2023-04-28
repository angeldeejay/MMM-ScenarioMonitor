const Log = require("logger");
const mqtt = require("mqtt");
const NodeHelper = require("node_helper");
const path = require("path");
const ping = require("ping");
const MODULE_NAME = path.basename(__dirname);

module.exports = NodeHelper.create({
  name: MODULE_NAME,
  logPrefix: `${MODULE_NAME} ::`,
  messagePrefix: `${MODULE_NAME}-`,
  defaults: {
    port: 1883,
    pingTarget: null,
    broker: null,
    waitTime: 60,
    ledsTopic: null,
    scenarioTopic: null,
    scenarioTopic: null,
    targetTopics: []
  },
  _states: {
    on: "ON",
    off: "OFF",
    idle: "IDLE"
  },
  _lastSeen: null,
  _client: null,
  _connected: false,
  _state: null,
  _ready: false,

  start() {
    this.log("Starting");
    this.config = {
      ...this.defaults,
      ...this.config
    };
    this._client = null;
    this._lastSeen = this._now();
    this._state = this._states.off;
    this._connected = false;
    this.connectToBroker();
    setInterval(() => this._sendNotification("READY", this._ready), 1000);
    this.log("Started");
  },

  // Logging wrapper
  log(...args) {
    Log.log(this.logPrefix, ...args);
  },
  info(...args) {
    Log.info(this.logPrefix, ...args);
  },
  debug(...args) {
    Log.debug(this.logPrefix, ...args);
  },
  error(...args) {
    Log.error(this.logPrefix, ...args);
  },
  warning(...args) {
    Log.warn(this.logPrefix, ...args);
  },

  _now() {
    return Math.floor(Date.now() / 1000);
  },
  vString(s) {
    return typeof s === "string" && s !== null && s.trim().length > 0;
  },
  vArray(a) {
    return Array.isArray(a) && a !== null && a.length > 0;
  },
  vInt(i) {
    return !isNaN(parseInt(i));
  },

  checkConfig(...args) {
    return Object.entries(this.config)
      .filter(([k, _]) => (args.length === 0 ? true : args.includes(k)))
      .reduce((acc, [key, value]) => {
        let valid = true;
        switch (key) {
          case "targetTopics":
            valid =
              valid &&
              this.vArray(value) &&
              value.reduce((a, b) => this.vString(b) && a, true);
            break;
          case "port":
          case "waitTime":
            valid = valid && this.vInt(value);
            break;
          case "broker":
          case "ledsTopic":
          case "monitorTopic":
          case "pingTarget":
          case "scenarioTopic":
            valid = valid && this.vString(value);
            break;
        }
        return valid && acc;
      }, true);
  },

  connectToBroker() {
    if (!this.checkConfig("broker", "port")) {
      this.debug("No broker/port in config. Skipping connection");
      setTimeout(() => {
        this.connectToBroker();
      }, 1000);
      return;
    }

    this.debug(`Connecting to ${this.config.broker}:${this.config.port}`);
    this._client = mqtt.connect({
      host: this.config.broker,
      port: this.config.port,
      protocol: "tcp"
    });

    this._client.on("connect", () => {
      this._connected = true;
      this.log("Connected to MQTT broker");
      this.monitorLoop();
    });

    this._client.on("error", (error) => {
      this.error("MQTT Error", error.toString());
      this._client.end(true);
    });

    this._client.on("close", () => {
      this._connected = false;
      this.warning("MQTT connection closed. Reconnecting...");
      this._client = null;
      setTimeout(() => {
        this.connectToBroker();
      }, 1000);
    });
  },

  monitorLoop() {
    if (!this._connected) return;

    this.publishMessage(this.config.monitorTopic, this._states.on);
    ping.promise
      .probe(this.config.pingTarget, { min_reply: 1, timeout: 1 })
      .then((res) => {
        const lastState = `${this._state}`;
        const counter = this._now() - this._lastSeen;
        if (res.alive) {
          this._lastSeen = this._now();
          this._state = this._states.on;
        } else if (counter < this.config.waitTime)
          this._state = this._states.idle;
        else if (counter >= this.config.waitTime)
          this._state = this._states.off;

        if (this._state !== lastState) this.log(`Detected ${this._state}`);
        else this.debug(`Detected ${this._state}`);
        [
          this.config.ledsTopic,
          this.config.scenarioTopic,
          ...this.config.targetTopics
        ]
          .filter((t) => t !== null && `${t}`.trim().length > 0)
          .forEach((t) => {
            switch (t) {
              case this.config.ledsTopic:
                if (this._state === this._states.off)
                  this.publishMessage(t, "PL=1");
                break;
              case this.config.scenarioTopic:
                this.publishMessage(t, this._state);
                break;
              default:
                if ([this._states.on, this._states.off].includes(this._state))
                  this.publishMessage(t, this._state);
            }
          });
      })
      .catch(() => void 0)
      .finally(() => setTimeout(() => this.monitorLoop(), 1000));
  },

  publishMessage(topic, message) {
    if (!this._client) return;
    this.debug(`Publishing to ${topic}: ${message}`);
    this._client.publish(topic, message, (error) => {
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

  __notificationReceivedHandler(notification, payload) {
    switch (notification) {
      case "SET_CONFIG":
        try {
          let changed = false;
          Object.entries({
            ...this.config,
            ...payload
          }).forEach(([key, value]) => {
            switch (key) {
              case "targetTopics":
                if (
                  this.vArray(value) &&
                  (payload[key].filter((t) => !this.config[key].includes(t))
                    .length > 0 ||
                    this.config[key].filter((t) => !payload[key].includes(t))
                      .length > 0)
                ) {
                  this.config.targetTopics = value;
                  changed = true;
                }
                break;
              case "port":
              case "waitTime":
                const parsed = parseInt(value, 10);
                if (this.vInt(value) && parsed !== this.config[key]) {
                  this.config[key] = parsed;
                  changed = true;
                }
                break;
              case "broker":
              case "ledsTopic":
              case "monitorTopic":
              case "pingTarget":
              case "scenarioTopic":
                if (this.vString(value) && value !== this.config[key]) {
                  this.config[key] = value;
                  changed = true;
                }
                break;
            }
          });

          const validConfig = this.checkConfig();
          if (!validConfig)
            throw new Error(`Invalid config ${JSON.stringify(payload)}`);
          if (changed) {
            this.info("Initialized");
            this.debug("with config: " + JSON.stringify(this.config, null, 2));
          }
          this._ready = true;
        } catch (err) {
          this._ready = false;
          this.config = {
            ...this.defaults
          };
          this.error(err);
          this._sendNotification("READY", this._ready);
        }
      default:
    }
  },

  socketNotificationReceived(notification, payload) {
    this.__notificationReceivedHandler(
      notification.replace(new RegExp(`^${this.messagePrefix}`, "gi"), ""),
      payload
    );
  }
});
