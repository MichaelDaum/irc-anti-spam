#!/usr/bin/env node

var irc = require("irc-upd");
var config = require(process.env.CONFIG_FILE || "./config");
var fs = require("fs");

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
    "whiteListFile": false,
    "blackListFile": false,
    "messages": [],
    "autoSendCommands": [],
    "banNick": true,
    "banUser": true,
    "banHost": true,
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

  self.blackList = [];
  self.whiteList = [];
  self.voiceTimers = {};
  self.numSpamMessages = 0;

  if (self.config.whiteListFile) {
    console.log("INFO: reading whitelist from "+self.config.whiteListFile);
    let data = fs.readFileSync(self.config.whiteListFile);
    self.whiteList = JSON.parse(data);
    console.log("INFO: ... "+self.whiteList.length+" entries found");
  }

  if (self.config.blackListFile) {
    console.log("INFO: reading blacklist from "+self.config.blackListFile);
    let data = fs.readFileSync(self.config.blackListFile);
    self.blackList = JSON.parse(data);
    console.log("INFO: ... "+self.blackList.length+" entries found");
  }

  self.client = new irc.Client(self.config.server, self.config.botName, {
    channels: config.channels,
    port: config.port,
    debug: config.debug,
    showErrors: config.showErrors,
    autoRejoin: config.autoRejoin,
    floodProtection: config.floodProtection,
    floodProtectionDelay: config.floodProtectionDelay,
    retryCount: config.retryCount,
    stripColors: true
  });

  self.client.addListener("message", function (nick, channel, text, message) {
    self.onMessage(nick, channel, text, message);
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

  self.client.addListener("join", function(channel, nick, message) {
    self.onJoin(nick, channel, message);
  });

  self.client.addListener("part", function(channel, nick) {
    self.onLeave(nick, channel);
  });

  self.client.addListener("quit", function(nick, reason, channels) {
    channels.forEach(function(channel) {
      self.onLeave(nick, channel);
    });
  });

  self.client.addListener("kick", function(channel, nick) {
    self.onLeave(nick, channel);
  });

  self.client.addListener("kill", function(nick, reason, channels) {
    channels.forEach(function(channel) {
      self.onLeave(nick, channel);
    });
  });

};

IrcAntiSpam.prototype.onJoin = function(nick, channel, message) {
  var self = this, 
    key = nick + "#" + channel;

  // process whiteList
  if (self.whiteList.indexOf(nick) !== -1) {
    console.log("INFO: immediately allow "+nick+" to speak");
    self.client.send("mode", channel, "+v", nick);
    return;
  }

  // process blackList
  if (self.blackList.indexOf(nick) !== -1) {
    console.log("INFO: immediately kick "+nick);
    self.handleSpammer(nick, channel, message);
    return;
  }

  // otherwise
  if (self.config.voiceDelay && nick !== self.config.botName) {

    console.log("INFO: will allow "+nick+" to speak after "+self.config.voiceDelay+"ms ... ");
    //self.client.say(channel, "Hi, "+nick+", you'll be allowed to speak soon.");

    self.voiceTimers[key] = setTimeout(function() {
      self.client.send("mode", channel, "+v", nick);
      delete self.voiceTimers[key];
    }, self.config.voiceDelay);
  }
};

IrcAntiSpam.prototype.onLeave = function(nick, channel) {
  var self = this,
    key = nick + "#" + channel;

  if (typeof(self.voiceTimers[key]) !== "undefined") {
    console.log("INFO: "+nick+" left too early to be able to speak");
    clearTimeout(self.voiceTimers[key]);
    delete self.voiceTimers[key];
  }
};

IrcAntiSpam.prototype.onMessage = function(nick, channel, text, message) {
  var self = this;

  if (self.echoRegExp.test(text)) {
    self.handleEcho(nick, channel);
    return;
  }

  if (self.infoRegExp.test(text)) {
    self.handleInfo(nick, channel);
    return;
  }

  if (self.whiteList.indexOf(nick) !== -1) {
    //console.log("INFO: found nick "+nick+" on whitelist");
    return;
  }

  if (self.blackList.indexOf(nick) !== -1) {
    console.log("WARNING: banned nick "+nick);
    self.numSpamMessages++;
    self.handleSpammer(nick, channel, message);
    return;
  }

  if (self.messagesRegExp && self.messagesRegExp.test(text)) {
    self.handleSpammer(nick, channel, message);
    return;
  }
};

IrcAntiSpam.prototype.handleInfo = function(nick, channel) {
  var self = this;

  self.client.say(channel, self.blackList.length + " user(s) kicked. " + self.numSpamMessages + " spam message(s) blocked.");
};

IrcAntiSpam.prototype.handleEcho = function(nick, channel) {
  var self = this;
  self.client.say(channel, "Hi, " + nick);
};

IrcAntiSpam.prototype.handleSpammer = function(nick, channel, message) {
  var self = this,
    user = message.user.replace(/^~/, ""),
    newSpammerFound = false;

  console.log("WARNING: spam detected ... kick-banning nick "+nick+" from channel "+channel);
  self.numSpamMessages++;

  if (self.blackList.indexOf(nick) === -1) {
    self.blackList.push(nick);
    newSpammerFound = true;
  }

  if (self.blackList.indexOf(user) === -1) {
    self.blackList.push(user);
    newSpammerFound = true;
  }

  self.client.send("kick", channel, nick, "you are a spammer");

  //console.log("INFO: banning nick '" + nick + "', user '" + user + "', host '" + message.host + "'");

  // nick ban
  if (self.config.banNick) {
    self.client.send("mode", channel, "+b", nick +"!*@*");
  }

  // user ban
  if (self.config.banUser) {
    self.client.send("mode", channel, "+b", "*!" + user + "@*");
  }

  // host ban
  if (self.config.banHost) {
    self.client.send("mode", channel, "+b", "*!*@" + message.host);
  }

  // update blacklist
  if (newSpammerFound && self.config.blackListFile) {
    let data = JSON.stringify(self.blackList);
    fs.writeFileSync(self.config.blackListFile, data);
  }
};

new IrcAntiSpam(config);
