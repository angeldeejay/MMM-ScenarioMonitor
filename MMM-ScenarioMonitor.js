/* global Module */
Module.register("MMM-ScenarioMonitor", {
  name: "MMM-ScenarioMonitor",
  logPrefix: "MMM-ScenarioMonitor :: ",
  messagePrefix: "MMM-ScenarioMonitor-",
  // Declare default inputs
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
  start() {
    this.config = {
      ...this.defaults,
      ...this.config
    };
    document.documentElement.classList.add(this.name);
    document.body.classList.add(this.name);
    this.setConfig();
  },

  setConfig() {
    this._sendNotification("SET_CONFIG", this.config);
    setTimeout(() => this.setConfig(), 1000);
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
          case this.state.on:
            document.documentElement.classList.remove("hide");
            document.body.classList.remove("hide");
            break;
          case this.state.off:
            document.documentElement.classList.add("hide");
            document.body.classList.add("hide");
            break;
          default:
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
