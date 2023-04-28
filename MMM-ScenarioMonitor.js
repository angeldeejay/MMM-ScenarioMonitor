/* global Module */
Module.register("MMM-ScenarioMonitor", {
  // Declare default inputs
  defaults: {
    port: 1883,
    pingTarget: null,
    broker: null,
    waitTime: 60,
    monitorTopic: null,
    ledsTopic: null,
    scenarioTopic: null,
    targetTopics: []
  },
  requiresVersion: "2.1.0",
  states: {
    on: "ON",
    off: "OFF",
    idle: "IDLE"
  },
  ready: false,

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
    Log.warning(this.logPrefix, ...args);
  },

  getHeaders() {
    return "";
  },

  start() {
    this.logPrefix = `${this.name} ::`;
    this.messagePrefix = `${this.name}-`;

    this.info("starting module");
    this.config = {
      ...this.defaults,
      ...this.config
    };
    this.ready = false;
    this.debug("with config: " + JSON.stringify(this.config, null, 2));
    document.documentElement.classList.add(this.name);
    document.body.classList.add(this.name);
    this.sendConfig();
    this.info("module started");
  },

  stop() {
    this.info("stopping module");
  },

  resume() {
    this.info("resuming module");
    this.debug("with config: " + JSON.stringify(this.config, null, 2));
    this.suspended = false;
    this.updateDom();
  },

  suspend() {
    this.info("suspending module");
    this.suspended = true;
  },

  sendConfig() {
    if (this.ready) return;
    this._sendNotification("SET_CONFIG", { ...this.defaults, ...this.config });
    setTimeout(() => this.sendConfig(), 1000);
  },

  _sendNotification(notification, payload) {
    this.sendSocketNotification(
      `${this.messagePrefix}${notification}`,
      payload
    );
  },

  _notificationReceived(notification, payload) {
    switch (notification) {
      case "STATE":
        switch (payload) {
          case this.states.on:
            document.documentElement.classList.remove("hide");
            document.body.classList.remove("hide");
            break;
          case this.states.off:
            document.documentElement.classList.add("hide");
            document.body.classList.add("hide");
            break;
          default:
        }
      case "READY":
        this.ready = payload;
        if (!this.ready)
          this._sendNotification("SET_CONFIG", {
            ...this.defaults,
            ...this.config
          });
        break;
      default:
    }
  },

  socketNotificationReceived(notification, payload) {
    this._notificationReceived(
      notification.replace(new RegExp(`^${this.messagePrefix}`, "gi"), ""),
      payload
    );
  }
});
