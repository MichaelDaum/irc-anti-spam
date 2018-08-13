#!/usr/bin/env node

var irc = require("irc");
var config = require(process.env.CONFIG_FILE || "./config");

var IrcAntiSpam = function (thisConfig) {
  var self = this;

  self.config = {
    "server": "irc.freenode.net",
    "botName": "IrcAntiSpam",
    "debug": false,
    "showErrors": true,
    "autoRejoin": true,
    "floodProtection": true,
    "floodProtectionDelay": 500,
    "retryCount": 10,
    "voiceDelay": 30000,
    "immediatelyVoicedNicks": [],
    "messages": [],
    "autoSendCommands": [],
    ... thisConfig
  };

  self.init();
};

IrcAntiSpam.prototype.init = function() {
  var self = this;

  if (self.config.messages.length) {
    self.messagesRegExp = new RegExp(self.config.messages.join("|"), "i");
  }

  self.echoRegExp = new RegExp("^"+self.config.botName+", hi");
  self.infoRegExp = new RegExp("^"+self.config.botName+", info");

  self.spammers = [];
  self.voiceTimers = {};
  self.numSpamMessages = 0;

  self.client = new irc.Client(self.config.server, self.config.botName, {
    channels: config.channels,
    port: config.port,
    debug: config.debug,
    showErrors: config.showErrors,
    autoRejoin: config.autoRejoin,
    floodProtection: config.floodProtection,
    floodProtectionDelay: config.floodProtectionDelay,
    retryCount: config.retryCount
  });

  self.client.addListener("message", function (user, channel, message) {
    self.onMessage(user, channel, message);
  });

  self.client.addListener("error", function(message) {
    console.log("ERROR: ", message);
  });

  self.client.addListener("notice", function(from, to, text) {
    console.log(text);
  });

  self.client.addListener("registered", function() {
    self.config.autoSendCommands.forEach(function(element) {
      self.client.send(...element);
    });
  });

  self.client.addListener("join", function(channel, user) {
    self.onJoin(user, channel);
  });

  self.client.addListener("part", function(channel, user) {
    self.onLeave(user, channel);
  });

  self.client.addListener("quit", function(user, reason, channels) {
    channels.forEach(function(channel) {
      self.onLeave(user, channel);
    });
  });

  self.client.addListener("kick", function(channel, user) {
    self.onLeave(user, channel);
  });

  self.client.addListener("kill", function(user, reason, channels) {
    channels.forEach(function(channel) {
      self.onLeave(user, channel);
    });
  });

};

IrcAntiSpam.prototype.onJoin = function(user, channel) {
  var self = this, 
    key = user + "#" + channel;

  if (self.config.voiceDelay && user !== self.config.botName) {
    // delayed +v
    if (self.config.immediatelyVoicedNicks.indexOf(user) === -1) {
      console.log("INFO: will allow "+user+" to speak after "+self.config.voiceDelay+"ms ... ");
      //self.client.say(channel, "Hi, "+user+", you'll be allowed to speak soon.");
      self.voiceTimers[key] = setTimeout(function() {
        self.client.send("mode", channel, "+v", user);
        delete self.voiceTimers[key];
      }, self.config.voiceDelay);
    } else {
      console.log("INFO: immediately allow "+user+" to speak");
      self.client.send("mode", channel, "+v", user);
    }
  }
};

IrcAntiSpam.prototype.onLeave = function(user, channel) {
  var self = this,
    key = user + "#" + channel;

  if (typeof(self.voiceTimers[key]) !== "undefined") {
    console.log("INFO: "+user+" left too early to be able to speak");
    clearTimeout(self.voiceTimers[key]);
    delete self.voiceTimers[key];
  }
};

IrcAntiSpam.prototype.onMessage = function(user, channel, message) {
  var self = this;
  //console.log(channel + " - " + user + ": " + message);

  if (self.echoRegExp.test(message)) {
    self.handleEcho(user, channel);
    return;
  }

  if (self.infoRegExp.test(message)) {
    self.handleInfo(user, channel);
    return;
  }

  if (self.spammers.indexOf(user) !== -1) {
    console.log("WARNING: banned user "+user);
    self.numSpamMessages++;
    self.handleSpammer(user, channel);
    return;
  }

  if (self.messagesRegExp && self.messagesRegExp.test(message)) {
    self.handleSpammer(user, channel);
    return;
  }
};

IrcAntiSpam.prototype.handleInfo = function(user, channel) {
  var self = this;

  self.client.say(channel, self.spammers.length + " user(s) kicked. " + self.numSpamMessages + " spam message(s) blocked.");
};

IrcAntiSpam.prototype.handleEcho = function(user, channel) {
  var self = this;
  self.client.say(channel, "Hi, " + user);
};

IrcAntiSpam.prototype.handleSpammer = function(user, channel) {
  var self = this;

  console.log("WARNING: spam detected ... kick-banning user "+user+" from channel "+channel);
  self.numSpamMessages++;

  if (self.spammers.indexOf(user) === -1) {
    self.spammers.push(user);
  }

  self.client.send("kick", channel, user, "you are a spammer");
  self.client.send("mode", channel, "+b", user +"!*@*");
};

new IrcAntiSpam(config);
