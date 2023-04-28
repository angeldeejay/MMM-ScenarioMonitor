const Log = require("logger");
const mqtt = require("mqtt");
const NodeHelper = require("node_helper");
const path = require("path");
const fs = require("fs");
const ping = require("ping");
const { clearTimeout } = require("timers");
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
  _shouldReconnect: false,
  _shouldConnectBroker: false,
  _state: null,
  _timer: null,
  _defaultConfig: null,

  start() {
    this.log("Starting");
    this._defaultConfig = this.config;
    this.config = {
      ...this.defaults,
      ...this._defaultConfig
    };
    this._client = null;
    this._timer = null;
    this._lastSeen = 0;
    this._state = this._states.off;
    this._connected = false;
    this._shouldConnectBroker = false;
    this._shouldReconnect = false;

    if (this.checkConfig()) this.connectToBroker();
    this.monitorLoop();
    this.notifyReady();
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

  notifyReady() {
    this._sendNotification("READY", this.checkConfig());
    setTimeout(() => this.notifyReady(), 1000);
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
    if (this._timer !== null) {
      clearTimeout(this._timer);
      this._timer = null;
    }
    const reconnectOnFail = this._shouldConnectBroker;
    this._shouldConnectBroker = false;
    this._shouldReconnect = false;

    if (this.client !== null) {
      try {
        this.client.end();
      } catch (_) {}
      delete this.client;
      this.client = null;
    }

    try {
      this._shouldReconnect = true;
      this.debug(`Connecting to ${this.config.broker}:${this.config.port}`);
      this._client = mqtt.connect({
        clientId:
          `scenarioMonitor_${this.instance}_` +
          Math.random()
            .toString(16)
            .replace(/[^\d]+/gim, ""),
        keepalive: 60,
        host: this.config.broker,
        port: this.config.port,
        protocol: "tcp",
        reconnectPeriod: 0,
        connectTimeout: 5 * 1000
      });
      this._client.on("connect", () => {
        this._connected = true;
        this.log("Connected to MQTT broker");
      });
      this._client.on("error", (error) => {
        this._connected = false;
        this._client.end(true);
      });
      this._client.on("reconnect", () => {
        this._connected = false;
        this.debug("Reconnecting to MQTT broker");
      });
      this._client.on("offline", () => {
        this._connected = false;
        this._client.end(true);
        this.warning("MQTT broker is offline");
      });
      this._client.on("end", () => {
        this._connected = false;
      });
      this._client.on("close", () => {
        this.warning("MQTT connection closed");
        this._shouldConnectBroker = reconnectOnFail;
        this._shouldReconnect = false;
        this._timer = setTimeout(() => this.connectToBroker(), 1000);
      });
    } catch (_) {
      this._shouldConnectBroker = reconnectOnFail;
      this._shouldReconnect = false;
      this._timer = setTimeout(() => this.connectToBroker(), 1000);
    }
  },

  monitorLoop() {
    if (!this._connected) {
      setTimeout(() => this.monitorLoop(), 1000);
      return;
    }

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
    if (!this._connected) return;
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
            this._shouldConnectBroker = true;
            this.connectToBroker();
          }
        } catch (err) {
          this.config = {
            ...this.defaults,
            ...this._defaultConfig
          };
          this.error(err);
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
